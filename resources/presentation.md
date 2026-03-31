# Coder Buddy — AI-Powered Collaborative IDE
### Presentation Outline

---

## Slide 1 — Title
**Coder Buddy**
> An AI-powered, containerized, collaborative web IDE

- Multi-agent code generation powered by LangGraph
- Real-time collaborative editing (CRDT)
- Per-user Docker isolation
- Live cursor presence

---

## Slide 2 — Problem Statement

**Traditional code generation tools lack:**
- Isolated execution environments per user
- Real-time multi-user collaboration
- End-to-end pipeline from idea → working code
- Integrated terminal + editor + AI in one place

**Coder Buddy solves all of this in a single browser tab.**

---

## Slide 3 — System Architecture Overview

```
Browser (React IDE)
       │
       ▼
Orchestrator (Node.js :3000)
  ├── Session Manager (Docker API)
  ├── Yjs WebSocket Server (:1234) ← CRDT sync
  └── REST Proxy → Session Containers
       │
       ▼
Per-Session Container (editor-server :9000)
  ├── PTY Terminal (node-pty)
  ├── File System (/workspace volume)
  └── AI Proxy → FastAPI
       │
       ▼
FastAPI (:8000)
  └── LangGraph AI Pipeline
        ├── Planner Agent
        ├── Architect Agent
        └── Coder Agent (loops per file)
```

---

## Slide 4 — Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Ace Editor, xterm.js |
| Orchestrator | Node.js, Express, Socket.IO, Dockerode |
| CRDT Sync | Yjs, y-websocket |
| Session Container | Node.js, node-pty, chokidar |
| AI Backend | Python, FastAPI, LangGraph, LangChain |
| LLM | Groq (openai/gpt-oss-120b) |
| Containerization | Docker, Docker Compose |

---

## Slide 5 — What is Agentic AI?

**Traditional AI:** Single prompt → single response. Stateless.

**Agentic AI:** AI that can plan, reason, take actions, observe results, and loop — like a developer working through a task.

```
Traditional:
  User: "Write a login page"
  LLM:  "Here is some code..." (one shot, no context)

Agentic:
  User: "Build a login page"
    → Agent plans what files are needed
    → Agent designs the architecture
    → Agent writes each file with awareness of others
    → Agent loops until all tasks are done
```

**Key properties of an agent:**
- Has a **goal** (complete the project)
- Has **memory** (previously generated files as context)
- Takes **actions** (generates code, writes files)
- Has **control flow** (loops, conditionals, branching)

---

## Slide 6 — What is LangGraph?

**LangGraph** is a framework for building stateful, multi-step AI pipelines as directed graphs.

```
Nodes  = Agent functions (planner, architect, coder)
Edges  = Flow between agents
State  = Shared data passed between nodes
```

**Why LangGraph over a simple chain?**

| Feature | LangChain Chain | LangGraph |
|---|---|---|
| Loops | ✗ | ✓ (conditional edges) |
| Shared state | Limited | Full state dict |
| Branching | ✗ | ✓ |
| Streaming | Limited | ✓ per node |
| Cycles | ✗ | ✓ |

**In Coder Buddy:**
- The Coder node loops back to itself until all files are written
- State carries the full `CoderState` (task plan + generated files) across iterations
- Each node update is streamed to the client in real-time via SSE

---

## Slide 7 — LangGraph State & Graph Definition

**State is a plain Python dict shared across all nodes:**

```python
# Each node receives and returns state
def planner_agent(state: dict) -> dict:
    resp = llm.with_structured_output(Plan, method="json_mode")
             .invoke(planner_prompt(state["user_prompt"]))
    return {"plan": resp, "messages": [...]}

def coder_agent(state: dict) -> dict:
    coder_state = state.get("coder_state")
    # ... generate code for current file ...
    coder_state.current_step_idx += 1
    return {"coder_state": coder_state, "messages": [...]}
```

**Graph wiring:**
```python
graph = StateGraph(dict)
graph.add_node("planner", planner_agent)
graph.add_node("architect", architect_agent)
graph.add_node("coder", coder_agent)

graph.add_edge("planner", "architect")
graph.add_edge("architect", "coder")

# Conditional loop: coder runs again until all files done
graph.add_conditional_edges(
    "coder",
    lambda s: "END" if s.get("status") == "DONE" else "coder",
    {"END": END, "coder": "coder"}
)
graph.set_entry_point("planner")
agent = graph.compile()
```

---

## Slide 8 — AI Agent Roles in Detail

### Planner Agent
- Input: raw user prompt
- Output: structured `Plan` object (JSON)
- Decides: project name, tech stack, features, list of files
- Enforces: vanilla HTML/CSS/JS only (no frameworks)
- Uses: `json_mode` + explicit JSON schema in prompt

### Architect Agent
- Input: `Plan` object
- Output: `TaskPlan` — ordered list of `ImplementationTask`
- Decides: exact order of file generation (HTML → CSS → JS)
- Provides: detailed task description per file including all IDs, classes, function names
- Purpose: gives the Coder enough context to write each file without seeing the others

### Coder Agent (loops)
- Input: current `CoderState` (task plan + previously generated files)
- Output: generated code for one file per iteration
- Context-aware: receives all previously written files so JS can reference HTML IDs
- Loops: increments `current_step_idx` each iteration
- Terminates: when `current_step_idx >= len(steps)` → sets `status = "DONE"`

---

## Slide 9 — AI Agent Workflow

```
User Prompt
     │
     ▼
┌─────────────┐
│   PLANNER   │  Converts prompt → structured Plan
│             │  (name, features, files, techstack)
└──────┬──────┘
       │ Plan (JSON)
       ▼
┌─────────────┐
│  ARCHITECT  │  Breaks Plan → ordered implementation tasks
│             │  (one task per file, HTML → CSS → JS)
└──────┬──────┘
       │ TaskPlan (JSON)
       ▼
┌─────────────┐
│    CODER    │◄─────────────────┐
│   (loop)    │  Generates code  │
│             │  for one file    │
└──────┬──────┘                  │
       │                         │
       ├── more files? ──────────┘
       │
       └── all done → status = DONE
              │
              ▼
       Written to /workspace
       inside session container
```

**Key design decisions:**
- Planner forces vanilla HTML/CSS/JS — no frameworks
- Architect orders tasks so HTML is always first (CSS/JS can reference IDs)
- Coder receives all previously generated files as context for consistency
- Uses `json_mode` with explicit schema in prompt to avoid Groq tool-calling issues

---

## Slide 10 — Structured Output & Pydantic Models

**Agents return typed Pydantic objects, not raw text:**

```python
class File(BaseModel):
    path: str       # e.g. "index.html"
    purpose: str    # e.g. "Main HTML markup"

class Plan(BaseModel):
    name: str
    description: str
    techstack: str
    features: list[str]
    files: list[File]

class ImplementationTask(BaseModel):
    filepath: str
    task_description: str

class TaskPlan(BaseModel):
    implementation_steps: list[ImplementationTask]

class CoderState(BaseModel):
    task_plan: TaskPlan
    current_step_idx: int = 0
    generated_files: dict[str, str] = {}  # filepath → code
```

**Why structured output?**
- Guarantees parseable, typed data between agents
- No regex parsing of LLM text
- Enables reliable state passing through the LangGraph pipeline

---

## Slide 11 — LLM & Groq Integration

**Model:** `openai/gpt-oss-120b` via Groq API

**Why Groq?**
- Extremely fast inference (LPU hardware)
- Low latency critical for streaming multi-step pipelines
- Supports structured output via `json_mode`

**Structured output challenge with Groq:**
- Default `tool_calling` method: model sometimes ignores the tool and returns markdown
- Fix: use `json_mode` + include the word "json" + embed explicit schema in prompt

```python
# This fails intermittently on Groq:
llm.with_structured_output(Plan).invoke(prompt)

# This works reliably:
llm.with_structured_output(Plan, method="json_mode").invoke(
    "Respond with a valid JSON object with this structure: {...}\n" + prompt
)
```

**Streaming:**
- LangGraph `.stream()` yields state updates per node
- FastAPI wraps this in SSE and streams to the browser
- Each agent's output appears in the chat panel as it completes

---

## Slide 12 — Real-Time Collaboration (CRDT)

**Problem with naive sync:**
- Last-write-wins causes data loss when two users edit simultaneously

**Solution: Yjs CRDT (Conflict-free Replicated Data Type)**

```
Tab A types "Hello"          Tab B types "World"
      │                              │
      ▼                              ▼
  Yjs Y.Doc                     Yjs Y.Doc
  (local op)                    (local op)
      │                              │
      └──────── Yjs WS Server ───────┘
                  (:1234)
                    │
              Merge via CRDT
                    │
         Both tabs see "HelloWorld"
         (no conflict, no data loss)
```

**How it works:**
1. Each file gets a unique `Y.Doc` keyed by `sessionId/filePath`
2. Every keystroke = a tiny Yjs operation (not a full file replace)
3. Yjs WebSocket server on port 1234 syncs ops between all tabs
4. Server debounces writes to disk every 500ms
5. GC enabled on server to prevent memory growth

---

## Slide 13 — Docker Isolation Architecture

**Why isolation?**
- Each user's terminal runs real shell commands
- Without isolation, users share the same filesystem and shell
- Security risk: one user can see/modify another's files

**Solution: One container per browser session**

```
Browser Tab 1 ──► Session Container A
                   ├── /workspace/project-a/
                   └── bash shell (isolated)

Browser Tab 2 ──► Session Container B
                   ├── /workspace/project-b/
                   └── bash shell (isolated)

Browser Tab 3 ──► Session Container A  (same session = shared)
                   └── sees same files as Tab 1
```

**Container lifecycle:**
1. New tab connects → Orchestrator spawns fresh container
2. Container gets its own named Docker volume (`coder-session-<uuid>`)
3. Tab disconnects → 5 second grace period → container stopped
4. Session picker lets users reconnect to existing containers

---

## Slide 14 — Orchestrator Deep Dive

**Responsibilities:**
- Manages Docker containers via Dockerode (Docker API)
- Proxies HTTP REST calls to the correct session container
- Proxies Socket.IO events to the correct session container
- Runs the Yjs WebSocket server for CRDT sync
- Broadcasts cursor positions between tabs in the same session

**Session routing:**
```
Client request
  + Header: x-session-id: <uuid>
       │
       ▼
Orchestrator looks up sessions Map
       │
       ▼
Forwards to http://<containerIP>:9000
```

**Key features:**
- Auto-detects Docker network name (no hardcoding)
- OS-assigned free ports (no port conflicts)
- Stale container cleanup on reconnect
- Spawn deduplication (prevents double containers)

---

## Slide 15 — Session Picker UI

**Flow when user opens the IDE:**

```
Open http://localhost:5173
         │
         ▼
  Session Picker Screen
  ┌─────────────────────┐
  │  ⚡ Coder Buddy      │
  │                     │
  │  [+ New Session]    │
  │                     │
  │  Running sessions:  │
  │  ● coder-session-.. │
  │  ● coder-session-.. │
  └─────────────────────┘
         │
    Pick existing or create new
         │
         ▼
  Container spins up / reconnects
         │
         ▼
       IDE loads
```

---

## Slide 16 — Cursor Presence

**How remote cursors work:**

1. User moves cursor in Ace editor
2. `cursor:move` event emitted via Socket.IO with `{ file, row, col }`
3. Orchestrator relays to all other sockets in the same session
4. Receiving tabs render an Ace marker at that position
5. Each tab gets a unique color from a palette
6. On tab disconnect → `cursor:leave` removes the marker

**Visual result:**
- Colored vertical bar at remote cursor position
- Colored dot badge showing short socket ID
- Updates in real-time as remote user types

---

## Slide 17 — File System & Watching

**Inside each session container:**

```
/workspace/
  └── project-name/        ← created by AI agent
        ├── index.html
        ├── styles.css
        └── app.js
```

**File watching with chokidar:**
- `usePolling: true` — required for Docker volumes (inotify unreliable)
- Poll interval: 500ms
- On any change → `file:refresh` event → client refreshes file tree

**File operations:**
- Read, create, delete via REST API
- Save via Yjs CRDT (debounced 500ms write to disk)
- AI-generated files written directly by the session container

---

## Slide 18 — Embedded Terminal

**Technology:** node-pty + xterm.js

- `node-pty` spawns a real PTY (pseudo-terminal) bash process
- PTY runs inside the session container → fully isolated shell
- xterm.js renders it in the browser with full color support
- Terminal resize events forwarded to PTY
- Shell starts in `/workspace` directory

**What users can do:**
- Run `mkdir`, `touch`, `npm install`, `python` etc.
- Files created via terminal appear in the file tree automatically
- Each tab's terminal is isolated to its own container

---

## Slide 19 — SSE Streaming (AI Pipeline)

**Why Server-Sent Events?**
- AI pipeline takes 10-30 seconds
- Users need live feedback as each agent completes

**Flow:**
```
POST /api/generate { prompt }
         │
         ▼
FastAPI streams SSE events:
  data: {"agent":"planner","status":"working",...}
  data: {"agent":"architect","status":"working",...}
  data: {"agent":"coder","generated_files":{...},...}
  data: {"agent":"system","status":"complete"}
         │
         ▼
Node server reads SSE stream
Writes files to /workspace as they arrive
Emits Socket.IO events to browser
         │
         ▼
Chat panel updates in real-time
File tree refreshes as files are written
```

---

## Slide 20 — Key Challenges & Solutions

| Challenge | Solution |
|---|---|
| Groq model ignores tool calls | Switched to `json_mode` with explicit JSON schema in prompt |
| Docker network name varies | Auto-detect network by name pattern at runtime |
| Port conflicts on container spawn | OS-assigned free ports via `net.createServer` |
| React StrictMode double-mount kills containers | 5s disconnect grace period before container teardown |
| chokidar misses events in Docker volumes | `usePolling: true` with 500ms interval |
| Yjs `bin/utils` removed in v3 | Downgraded to y-websocket v2 which ships server utils |
| Memory explosion with full-replace CRDT | `isApplyingRemote` flag + proper Yjs state management |
| Container name conflicts on respawn | Force-remove stale container before creating new one |
| LangGraph coder needs cross-file context | `generated_files` dict passed as context to each coder iteration |

---

## Slide 21 — Future Improvements

- **OT/CRDT for terminal output** — sync terminal between tabs
- **Persistent sessions** — save/restore container state across restarts
- **Multi-language AI** — support React, Python, FastAPI projects
- **User authentication** — tie sessions to user accounts
- **File preview** — live browser preview of generated HTML projects
- **Resource limits** — CPU/memory caps per container
- **Session sharing links** — share a session URL with teammates
- **Agent memory** — let agents remember past projects and preferences
- **Tool-using agents** — give Coder agent ability to run code and fix errors

---

## Slide 22 — Demo Flow

1. Open `http://localhost:5173`
2. Click **New Session** → container spins up
3. Type in AI chat: *"create a simple calculator"*
4. Watch **Planner** → **Architect** → **Coder** agents work in real-time
5. Files appear in explorer as they're generated
6. Open `index.html` in the editor
7. Open same session in a second tab
8. Edit in one tab → see changes instantly in the other (CRDT)
9. Move cursor → see colored cursor in the other tab
10. Open terminal → run `ls /workspace` → see generated files

---

*Built with LangGraph · Yjs · Docker · React · Node.js · FastAPI · Groq*
