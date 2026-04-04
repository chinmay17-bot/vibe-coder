# ⚡ Coder Buddy IDE

**Coder Buddy** is an AI-powered collaborative IDE built with [LangGraph](https://github.com/langchain-ai/langgraph), [CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) real-time collaboration, and Docker-based sandboxed environments.

It features a multi-agent AI pipeline that takes natural language requests and transforms them into complete, working projects — supporting **HTML/CSS/JS, Python, C, C++, and Java**. Beyond code generation, Coder Buddy also serves as an intelligent conversational assistant that can explain code, fix bugs, suggest improvements, and modify existing files with smart context awareness.

---

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│ React Client │────▶│ Orchestrator │────▶│  Editor Server   │
│  (Vite)     │ WS  │  (Node.js)   │ WS  │  (per-session)   │
│  :5173      │     │  :3000       │     │  Docker :9000     │
└─────────────┘     └──────┬───────┘     └────────┬─────────┘
                           │                      │
                    ┌──────▼───────┐        REST /api/edit
                    │   Yjs CRDT   │        REST /api/generate
                    │   :1234      │        REST /api/chat
                    └──────────────┘        REST /api/execute
                                                  │
                                    ┌──────────────▼──────────────┐
                                    │     FastAPI + AI Pipeline    │
                                    │          :8000               │
                                    └──────────────┬──────────────┘
                                                   │
                                    ┌──────────────▼──────────────┐
                                    │    LangGraph Multi-Agent     │
                                    │ Planner → Architect → Coder  │
                                    │ Edit Coder (single-node)     │
                                    │ Chat Agent (dual-model)      │
                                    └─────────────────────────────┘
```

---

## ✨ Key Features

### 🤖 AI Pipelines (3 Modes)

| Mode | Trigger | Pipeline | Description |
|------|---------|----------|-------------|
| **Build** | `build a calculator` | Planner → Architect → Coder (loop) | Creates entire projects from scratch using a multi-agent pipeline |
| **Edit** | `/edit filepath instruction` | Edit Coder (single node) | Modifies existing files in-place, skipping Planner & Architect |
| **Chat** | Any other message | Chat Agent (dual-model) | Conversational Q&A, code explanation, bug detection, and smart code modifications |

### 🧠 Dual-Model Architecture
- **Llama 3.3 70B** (`llama-3.3-70b-versatile`) — Used for code generation, planning, architecture, and code modification requests
- **Llama 3.1 8B** (`llama-3.1-8b-instant`) — Used for fast conversational responses and general Q&A

### 🔧 Smart Intent Detection
The Chat Agent automatically detects whether the user is asking a question or requesting a code modification:
- **Code modification** (e.g., "add dark mode", "fix the bug", "make it responsive") → Routes to the 70B model, outputs complete updated file, and auto-applies changes
- **General question** (e.g., "explain this code", "what is an API?") → Routes to the 8B model for fast conversational responses

### 💻 IDE Features
- **Multi-language support** — HTML/CSS/JS, Python, C, C++, Java, TypeScript, YAML, Markdown, and more
- **VS Code-inspired UI** — Dark theme (One Dark), file tree sidebar, tab management, breadcrumbs, activity bar
- **Ace Editor** — Syntax highlighting, autocomplete, snippets, line numbers, JetBrains Mono font
- **Integrated terminal** — Full terminal access via `node-pty` with xterm.js
- **Live preview** — Real-time HTML preview in an embedded iframe with refresh support
- **File management** — Create, delete, rename files/folders via right-click context menu
- **Code execution** — Run Python, JavaScript, C, C++, and Java files directly with the ▶ Run button
- **Quick actions** — One-click buttons to Explain, Fix, Improve, or get Run instructions for the open file

### 👥 Real-Time Collaboration
- **CRDT sync** — Multiple users can edit the same file simultaneously via Yjs with conflict-free merging
- **Yjs WebSocket server** — Runs on port 1234 with debounced file persistence to disk
- **Cursor sharing** — See other users' cursor positions in real-time
- **Session management** — Each user gets a Docker container; multiple users can join the same session

### 🐳 Docker Architecture
- **Sandboxed environments** — Each session runs in its own Docker container with isolated filesystem
- **Orchestrator** — Manages container lifecycle (spawn, attach, destroy) with automatic cleanup
- **Persistent volumes** — Session data persists across container restarts via Docker volumes
- **Session picker** — UI component to create new sessions or rejoin existing ones

### 💬 Conversation History
- Chat messages are persisted to `localStorage` per session
- Clear history with the 🗑️ button
- Messages display with agent-specific colors and labels (Planner, Architect, Coder, Assistant)

---

## 🚀 Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A [Groq API key](https://console.groq.com/keys)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd vibe-coder-CRDT-test
   ```

2. **Create a `.env` file** with your Groq API key:
   ```bash
   GROQ_API_KEY=your_groq_api_key_here
   ```

3. **Build and start all services:**
   ```bash
   docker compose up --build
   ```
   This builds:
   - `fastapi` — AI pipeline (port 8000)
   - `orchestrator` — Session manager & CRDT sync (port 3000 + 1234)
   - `client` — React IDE (port 5173)
   - `editor-server` — Spawned per-session (port 9000, internal)

4. **Open the IDE** at [http://localhost:5173](http://localhost:5173)

### Local Development (without Docker)

1. **Python AI backend:**
   ```bash
   pip install uv
   uv venv && source .venv/bin/activate  # Linux/Mac
   # or: uv venv && .venv\Scripts\activate  # Windows
   uv sync
   python server.py
   ```

2. **Editor server:**
   ```bash
   cd editor/server && npm install && node index.js
   ```

3. **React client:**
   ```bash
   cd editor/client && npm install && npm run dev
   ```

> **Note:** In local mode, the client connects directly to the editor server on port 9000 (skipping the orchestrator). Collaboration features require Docker deployment.

---

## 🧪 Example Usage

### Build Mode (create new projects)
```
build a calculator
create a todo app with dark mode
write a prime number checker in python
implement a linked list in C++
build a student management system in Java
```

### Chat Mode (ask questions or modify code)
```
What is an API?
Explain this code step by step
How do I run this file?
Add a dark mode toggle button        ← auto-detects as code modification
Fix the bug in this function          ← auto-detects as code modification
Make it responsive                    ← auto-detects as code modification
```

### Quick Actions (one-click when a file is open)
- 💡 **Explain** — Walk through the code step by step
- 🔧 **Fix** — Find and suggest bug fixes
- ✨ **Improve** — Suggest performance and readability improvements
- ▶️ **Run** — Get step-by-step instructions to run the file

---

## 📁 Project Structure

```
├── agent/                      # AI pipeline (Python + LangGraph)
│   ├── graph.py               # Agent definitions: Build, Edit, Chat graphs
│   ├── prompts.py             # System prompts for all agents & modes
│   ├── states.py              # Pydantic models (Plan, TaskPlan, CoderState, EditRequest)
│   └── tools.py               # File system tools
├── editor/
│   ├── client/                # React + Vite frontend (IDE UI)
│   │   └── src/
│   │       ├── App.jsx        # Main IDE layout, file management, code execution
│   │       ├── App.css        # Full IDE styling (VS Code-inspired dark theme)
│   │       ├── socket.js      # Socket.IO client connection
│   │       └── components/
│   │           ├── Chatbot.jsx        # AI chat panel with smart routing
│   │           ├── Chatbot.css        # Chat panel styling
│   │           ├── tree.jsx           # File explorer with context menu
│   │           ├── terminal.jsx       # xterm.js terminal component
│   │           ├── SessionPicker.jsx  # Docker session management UI
│   │           └── SessionPicker.css  # Session picker styling
│   └── server/                # Per-session editor server (Node.js + Express)
│       └── index.js           # File API, terminal (pty), AI proxy, code extraction
├── orchestrator/              # Session orchestrator (Node.js)
│   └── index.js               # Docker container management, Yjs CRDT, session proxy
├── server.py                  # FastAPI server — /api/generate, /api/edit, /api/chat, /api/execute
├── docker-compose.yml         # Multi-service Docker setup (4 services)
├── Dockerfile.python          # FastAPI + language runtimes image
├── pyproject.toml             # Python dependencies (uv/pip)
├── resources/                 # Documentation assets
│   ├── coder_buddy_diagram.mmd   # Architecture diagram (Mermaid)
│   └── coder_buddy_diagram.png   # Architecture diagram (rendered)
└── .env                       # Environment variables (GROQ_API_KEY)
```

---

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Streams multi-agent pipeline (Planner → Architect → Coder) via SSE |
| `/api/edit` | POST | Streams single-agent file edit via SSE (skips planning) |
| `/api/chat` | POST | Streams conversational AI response via SSE (dual-model) |
| `/api/execute` | POST | Executes code in a subprocess and returns stdout/stderr |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **AI Framework** | LangGraph + LangChain |
| **LLM Provider** | Groq (Llama 3.3 70B + Llama 3.1 8B) |
| **Backend** | FastAPI (Python) |
| **Editor Server** | Node.js + Express + Socket.IO + node-pty |
| **Frontend** | React + Vite + Ace Editor + xterm.js |
| **Collaboration** | Yjs (CRDT) + y-websocket |
| **Containerization** | Docker + Docker Compose + Dockerode |
| **File Watching** | chokidar |

---

© Coder Buddy. All rights reserved.