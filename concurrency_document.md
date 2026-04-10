# Concurrency in Multi-User Document Collaboration — Coder Buddy

## 1. Overview

Coder Buddy is a collaborative, cloud-based IDE where **multiple users can open and edit the same document simultaneously** within a shared session. Maintaining consistency—ensuring no edits are lost, no data is corrupted, and all users see the same final state—requires a carefully designed concurrency model.

This document provides a deep-dive into **how concurrency is maintained**, **how race conditions are prevented**, and **how critical sections are handled** across every layer of the system.

---

## 2. System Architecture (Concurrency Perspective)

```mermaid
graph TB
    subgraph Clients ["Browser Clients (React + Ace Editor)"]
        C1["User A — Browser"]
        C2["User B — Browser"]
        C3["User N — Browser"]
    end

    subgraph Orchestrator ["Orchestrator Server (port 3000)"]
        SO["Socket.IO Hub"]
        YJS["Yjs WebSocket Server (port 1234)"]
        SM["Session Manager"]
        PROXY["REST/Socket Proxy"]
    end

    subgraph Containers ["Per-Session Docker Containers"]
        ES1["Editor Server (port 9000)"]
        FS1["File System (/workspace)"]
    end

    C1 -- "Socket.IO" --> SO
    C2 -- "Socket.IO" --> SO
    C3 -- "Socket.IO" --> SO

    C1 -- "WebSocket (Yjs)" --> YJS
    C2 -- "WebSocket (Yjs)" --> YJS
    C3 -- "WebSocket (Yjs)" --> YJS

    SO -- "Proxy Events" --> ES1
    YJS -- "Persist (debounced)" --> ES1
    SM -- "Docker API" --> ES1
    ES1 -- "Read/Write" --> FS1
```

### Key Components Involved in Concurrency

| Component | Role in Concurrency |
|---|---|
| **Yjs (CRDT Library)** | Conflict-free merging of simultaneous edits |
| **y-websocket** | Syncs Yjs document state between all connected peers in real-time |
| **Orchestrator** | Central hub — routes sockets, manages sessions, runs Yjs server |
| **Socket.IO** | Broadcasts cursor positions, file changes, and system events |
| **Editor Server** | Per-session container handling file I/O — the "source of truth" on disk |
| **Ace Editor** | Client-side editor bound to Yjs — bidirectional data binding |

---

## 3. The CRDT Foundation — How Yjs Eliminates Conflicts

### 3.1 What is a CRDT?

A **CRDT (Conflict-free Replicated Data Type)** is a data structure that can be independently modified on multiple replicas and **always converges to the same state** without requiring a central coordinator or locks.

Yjs implements a **sequence CRDT** specifically designed for collaborative text editing. Each character in the document has:

- A **unique ID** (client ID + clock counter)
- A **position** relative to its left and right neighbors
- **Tombstone markers** for deleted characters

> [!IMPORTANT]
> CRDTs are the core reason this system can support concurrent edits without locks or mutexes. Unlike traditional approaches (OT, locking), CRDTs guarantee convergence **mathematically**, regardless of network ordering or timing.

### 3.2 How It Works in the Codebase

**File:** [useYjsDoc.js](file:///d:/coder-assist-main/coder-assist-main/editor/client/src/hooks/useYjsDoc.js)

```javascript
// Each file in each session gets a unique Yjs document
const docName = `${sessionId}/${filePath.replace(/^\//, '')}`;

const doc = new Y.Doc();
const ytext = doc.getText('content');

// Connect to the central Yjs WebSocket server
const provider = new WebsocketProvider(YJS_URL, docName, doc);
```

**What happens when two users type at the same position simultaneously:**

```mermaid
sequenceDiagram
    participant A as User A
    participant YJS as Yjs Server (port 1234)
    participant B as User B

    Note over A,B: Both users have cursor at position 10

    A->>YJS: insert("Hello", pos=10) — clock=1
    B->>YJS: insert("World", pos=10) — clock=1

    Note over YJS: Yjs merges using unique IDs<br/>Order: deterministic by client ID

    YJS->>A: Merged state: "HelloWorld" at pos 10
    YJS->>B: Merged state: "HelloWorld" at pos 10

    Note over A,B: Both editors show identical text ✅
```

### 3.3 The Convergence Guarantee

| Scenario | Traditional Approach | Yjs CRDT Approach |
|---|---|---|
| Two users insert at the same position | **Race condition** — one overwrite wins | Both insertions preserved; ordered deterministically by client ID |
| User A deletes text while User B edits it | **Conflict** — requires manual resolution | Deletion is a tombstone; B's edit applies to remaining text |
| Network partition — users edit offline | **Data loss** when reconnecting | All operations merge cleanly on reconnect |
| Messages arrive out of order | **Corrupted state** | CRDTs are **commutative** and **idempotent** — order doesn't matter |

---

## 4. Real-Time Synchronization Pipeline

### 4.1 End-to-End Flow: User A Types → User B Sees It

```mermaid
sequenceDiagram
    participant AceA as Ace Editor (User A)
    participant YjsA as Yjs Doc (User A)
    participant WS as Yjs WebSocket Server
    participant YjsB as Yjs Doc (User B)
    participant AceB as Ace Editor (User B)
    participant Disk as File System (Container)

    AceA->>AceA: User types "x" at position 5
    AceA->>YjsA: Ace onChange → ytext.insert(5, "x")
    Note over AceA: isApplyingRemote = true (prevents re-entry)

    YjsA->>WS: Yjs sync protocol (binary update)
    WS->>YjsB: Broadcast update to all peers
    WS->>WS: scheduleFilePersist(docName) [debounced 500ms]

    YjsB->>YjsB: Apply update → ytext.observe fires
    YjsB->>AceB: Convert Yjs delta → Ace insert(row, col, "x")
    Note over AceB: isApplyingRemote = true (prevents feedback loop)

    WS->>Disk: After 500ms debounce → HTTP POST /files/content-write
```

### 4.2 The Bidirectional Binding (Critical Section #1)

**File:** [App.jsx — Lines 112-179](file:///d:/coder-assist-main/coder-assist-main/editor/client/src/App.jsx#L112-L179)

This is the most critical piece of concurrency logic in the client:

```javascript
let isApplyingRemote = false;

// Yjs → Ace: apply remote changes
const onYjsUpdate = (event) => {
    if (isApplyingRemote) return;    // ← CRITICAL: prevent infinite loop
    isApplyingRemote = true;
    try {
        event.changes.forEach(change => {
            if (change.retain) { index += change.retain; }
            else if (change.insert) {
                const pos = doc.indexToPosition(index, 0);
                aceSession.insert(pos, change.insert);
            }
            else if (change.delete) {
                const start = doc.indexToPosition(index, 0);
                const end = doc.indexToPosition(index + change.delete, 0);
                aceSession.remove({ start, end });
            }
        });
    } catch { /* fallback: full reset */ }
    isApplyingRemote = false;
};

// Ace → Yjs: convert local edit to CRDT op
const onAceChange = (delta) => {
    if (isApplyingRemote) return;    // ← CRITICAL: prevent feedback loop
    isApplyingRemote = true;
    try {
        const start = doc.positionToIndex(delta.start, 0);
        if (delta.action === 'insert') {
            ytext.insert(start, delta.lines.join('\n'));
        } else if (delta.action === 'remove') {
            ytext.delete(start, delta.lines.join('\n').length);
        }
    } catch (e) { console.warn('[Yjs] delta error:', e.message); }
    isApplyingRemote = false;
};
```

> [!CAUTION]
> **The `isApplyingRemote` flag is the most important critical section guard in the entire system.**
> Without it, a change from Yjs would trigger an Ace `onChange`, which would write back to Yjs, which would trigger another Ace change — creating an **infinite feedback loop** that crashes the browser.

#### How the Guard Works:

```mermaid
flowchart TD
    A["User A types 'x'"] --> B["Ace onChange fires"]
    B --> C{isApplyingRemote?}
    C -- "false" --> D["Set isApplyingRemote = true"]
    D --> E["ytext.insert(pos, 'x')"]
    E --> F["Yjs broadcasts to peers"]
    F --> G["Set isApplyingRemote = false"]

    H["Remote update arrives via Yjs"] --> I["ytext.observe fires"]
    I --> J{isApplyingRemote?}
    J -- "false" --> K["Set isApplyingRemote = true"]
    K --> L["aceSession.insert(pos, 'x')"]
    L --> M["Ace onChange fires AGAIN"]
    M --> N{isApplyingRemote?}
    N -- "true ✅" --> O["SKIP — prevents infinite loop"]
    K --> P["Set isApplyingRemote = false"]

    style O fill:#2d5a3d,stroke:#4ade80,color:#fff
    style D fill:#1e3a5f,stroke:#60a5fa,color:#fff
    style K fill:#5a2d2d,stroke:#f87171,color:#fff
```

---

## 5. Race Conditions — Identified and Mitigated

### 5.1 Race Condition: Document Initialization

**Problem:** When the first user opens a file, the Yjs document is empty and needs to be seeded with the file content from disk. But what if two users open the same file at nearly the same time?

**File:** [useYjsDoc.js — Lines 40-49](file:///d:/coder-assist-main/coder-assist-main/editor/client/src/hooks/useYjsDoc.js#L40-L49)

```javascript
provider.on('sync', (isSynced) => {
    if (isSynced) {
        // RACE GUARD: Only seed if the document is still empty
        if (ytext.length === 0 && initialContent) {
            doc.transact(() => {
                ytext.insert(0, initialContent);
            });
        }
        setSynced(true);
    }
});
```

**Mitigation Strategy:**

| Check | What it prevents |
|---|---|
| `ytext.length === 0` | If another user already seeded the doc, we skip seeding — prevents **duplicate content** |
| `doc.transact(() => {...})` | Groups the insert into a single atomic Yjs transaction — prevents **partial states** visible to other peers |
| `provider.on('sync')` | Waits until the Yjs server confirms sync — ensures we see the **latest state** before deciding to seed |

```mermaid
sequenceDiagram
    participant A as User A
    participant YJS as Yjs Server
    participant B as User B (arrives 50ms later)

    A->>YJS: Connect to doc "session123/index.html"
    YJS->>A: sync event (isSynced=true, doc is empty)
    A->>A: ytext.length === 0 → seed with file content
    A->>YJS: ytext.insert(0, fileContent)

    B->>YJS: Connect to doc "session123/index.html"
    YJS->>B: sync event (isSynced=true, doc has content)
    B->>B: ytext.length > 0 → SKIP seeding ✅
```

### 5.2 Race Condition: Container Spawning

**Problem:** If two browser tabs for the same session try to spawn a container simultaneously, you'd get duplicate containers.

**File:** [orchestrator/index.js — Lines 62-67, 296-311](file:///d:/coder-assist-main/coder-assist-main/orchestrator/index.js#L62-L67)

```javascript
// Track in-progress spawns to prevent duplicate containers
const spawning = new Map();

async function attachSession(socket, sessionId, forceNew) {
    let session = sessions.get(sessionId);

    if (!session || forceNew) {
        if (spawning.has(sessionId)) {
            // ANOTHER socket is already spawning this session — WAIT for it
            session = await spawning.get(sessionId);
        } else {
            // First request: start spawning, store the promise
            const spawnPromise = spawnContainer(sessionId);
            spawning.set(sessionId, spawnPromise);
            session = await spawnPromise;
            spawning.delete(sessionId);
            sessions.set(sessionId, session);
        }
    }
}
```

**Mitigation: Promise Coalescing Pattern**

```mermaid
sequenceDiagram
    participant S1 as Socket A
    participant ORC as Orchestrator
    participant S2 as Socket B
    participant D as Docker

    S1->>ORC: session:select("abc123")
    ORC->>ORC: spawning.has("abc123")? NO
    ORC->>ORC: spawnPromise = spawnContainer("abc123")
    ORC->>ORC: spawning.set("abc123", spawnPromise)
    ORC->>D: Create container...

    S2->>ORC: session:select("abc123") [arrives during spawn]
    ORC->>ORC: spawning.has("abc123")? YES ✅
    ORC->>ORC: session = await spawning.get("abc123")
    Note over ORC: Socket B waits on the SAME promise

    D->>ORC: Container ready
    ORC->>ORC: spawning.delete("abc123")
    ORC->>S1: session:status → ready
    ORC->>S2: session:status → ready

    Note over S1,S2: Both sockets share ONE container ✅
```

> [!NOTE]
> This is a classic **"promise coalescing"** or **"request deduplication"** pattern. The key insight is that JavaScript Promises can be shared: multiple callers can `await` the same promise, and they'll all receive the result when it resolves.

### 5.3 Race Condition: File Persistence from Yjs

**Problem:** Every keystroke triggers a Yjs `update` event. If each update immediately wrote to disk, you'd get:
- Excessive I/O thrashing
- Potential write-write conflicts (two writes overlapping for the same file)
- Performance degradation

**File:** [orchestrator/index.js — Lines 38-61](file:///d:/coder-assist-main/coder-assist-main/orchestrator/index.js#L38-L61)

```javascript
const persistDebounces = new Map();

async function scheduleFilePersist(docName) {
    // CANCEL any pending write for this document
    if (persistDebounces.has(docName)) {
        clearTimeout(persistDebounces.get(docName));
    }

    // SCHEDULE a new write 500ms in the future
    persistDebounces.set(docName, setTimeout(async () => {
        persistDebounces.delete(docName);
        const doc = docs.get(docName);
        if (!doc) return;

        const [sessionId, ...fileParts] = docName.split('/');
        const filePath = fileParts.join('/');
        const session = sessions.get(sessionId);
        if (!session) return;

        const ytext = doc.getText('content');
        const content = ytext.toString();

        // Single HTTP call to persist the final state
        await fetch(`http://${session.host}:9000/files/content-write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content }),
        });
    }, 500));
}
```

**Why 500ms debounce works:**

```
User types: H → e → l → l → o

Time:  0ms   50ms  100ms  150ms  200ms  ...  700ms
Event:  H      e      l      l      o         ⬇️
Timer: [500ms] [reset] [reset] [reset] [reset] [FIRE]
                                                  ↓
                                            Write "Hello" to disk (one I/O)
```

> [!TIP]
> The debounce ensures **at most one write per 500ms per file**, regardless of how fast users type. The write always contains the **latest** content because it reads from the Yjs document at write time, not from the event that triggered it.

### 5.4 Race Condition: Stale Container Cleanup

**Problem:** When a user disconnects, should the container be destroyed? What if they reconnect within seconds?

**File:** [orchestrator/index.js — Lines 380-399](file:///d:/coder-assist-main/coder-assist-main/orchestrator/index.js#L380-L399)

```javascript
socket.on('disconnect', async () => {
    upstream.disconnect();
    broadcastToSession('cursor:leave', { socketId: socket.id });

    // Remove from session group
    const peers = sessionSockets.get(sessionId);
    if (peers) {
        peers.delete(socket.id);
        if (peers.size === 0) sessionSockets.delete(sessionId);
    }

    // GRACE PERIOD: wait 5 seconds before checking if session is truly empty
    setTimeout(async () => {
        const remaining = [...io.sockets.sockets.values()].filter(
            s => s.data.sessionId === sessionId
        );
        if (remaining.length === 0) {
            await destroySession(sessionId);
        }
    }, 5000);
});
```

**Mitigation: 5-Second Grace Period**

- On disconnect, the orchestrator waits **5 seconds** before checking if any sockets remain
- If a user refreshes the page, they'll reconnect within 5 seconds, so the container survives
- If truly no one is connected, the container is destroyed, freeing resources

---

## 6. Critical Sections — Detailed Analysis

### 6.1 Definition

A **critical section** is a region of code where shared mutable state is accessed, and concurrent execution could lead to inconsistent data. In this project, critical sections are protected through various mechanisms.

### 6.2 Summary of All Critical Sections

| # | Location | Shared State | Guard Mechanism | What It Prevents |
|---|---|---|---|---|
| 1 | Ace ↔ Yjs binding | Editor content + Yjs text | `isApplyingRemote` boolean flag | Infinite feedback loop between Ace and Yjs |
| 2 | Document seeding | Yjs document content | `ytext.length === 0` check + `doc.transact()` | Duplicate content insertion |
| 3 | Container spawning | `sessions` Map, `spawning` Map | Promise coalescing | Duplicate Docker containers |
| 4 | File persistence | Disk file content | Debounce timer (`persistDebounces` Map) | I/O thrashing, write-write conflicts |
| 5 | Session tracking | `sessionSockets` Map | Set-based add/delete + timeout grace period | Premature container destruction |
| 6 | Cursor broadcasting | Cursor position state | Socket ID filtering (`peerId !== socket.id`) | Cursor echo back to sender |
| 7 | Generated file writes | `writtenFiles` Set | Set membership check | Duplicate file writes during AI generation |

### 6.3 Critical Section #1: The `isApplyingRemote` Guard (Deep Dive)

This is a **reentrant guard** pattern — a single boolean that prevents a function from re-entering itself through an indirect call chain:

```
┌─────────────────────────────────────────────────┐
│              CRITICAL SECTION                    │
│                                                  │
│  isApplyingRemote = true                         │
│  ┌─────────────────────────────────────────┐     │
│  │  Modify Ace Editor content              │     │
│  │     ↓                                   │     │
│  │  Ace fires onChange                     │     │
│  │     ↓                                   │     │
│  │  onAceChange checks isApplyingRemote    │     │
│  │     ↓                                   │     │
│  │  isApplyingRemote === true → EXIT ✅    │     │
│  └─────────────────────────────────────────┘     │
│  isApplyingRemote = false                        │
│                                                  │
└─────────────────────────────────────────────────┘
```

> [!WARNING]
> This pattern works because **JavaScript is single-threaded**. In a multi-threaded environment, this boolean flag would itself be a race condition. In the browser's event loop, only one event handler runs at a time, making this safe.

### 6.4 Critical Section #2: Yjs Transactions

```javascript
doc.transact(() => {
    ytext.insert(0, initialContent);
});
```

A `doc.transact()` call:
1. **Batches** all operations inside the callback into a single update
2. Ensures peers see the operations **atomically** — they either get all of them or none
3. Generates a **single `update` event** instead of one per operation
4. Prevents other `observe` callbacks from firing until the transaction completes

This is equivalent to a **transaction** in a database — it provides **atomicity** and **isolation**.

### 6.5 Critical Section #3: Socket Session Routing

**File:** [orchestrator/index.js — Lines 337-350](file:///d:/coder-assist-main/coder-assist-main/orchestrator/index.js#L337-L350)

```javascript
// Track all sockets sharing this session
if (!sessionSockets.has(sessionId)) sessionSockets.set(sessionId, new Set());
sessionSockets.get(sessionId).add(socket.id);

// Broadcast: send to peers only, NOT back to sender
const broadcastToSession = (event, data) => {
    const peers = sessionSockets.get(sessionId);
    if (!peers) return;
    for (const peerId of peers) {
        if (peerId === socket.id) continue;  // ← Skip self
        const peer = io.sockets.sockets.get(peerId);
        if (peer) peer.emit(event, data);
    }
};
```

The `peerId === socket.id` check prevents **echo** — where a user's own change bounces back to them through the broadcast, causing a stale state or visual flicker.

---

## 7. Concurrency Layers — Defense in Depth

The system uses **multiple independent layers** to ensure consistency:

```mermaid
graph TB
    subgraph L1 ["Layer 1: Mathematical (CRDT)"]
        CRDT["Yjs CRDT guarantees convergence<br/>regardless of message order"]
    end

    subgraph L2 ["Layer 2: Protocol (y-websocket)"]
        SYNC["Yjs sync protocol ensures all peers<br/>receive all updates, handles reconnection"]
    end

    subgraph L3 ["Layer 3: Application (Guards)"]
        GUARD["isApplyingRemote flag prevents<br/>infinite loops in editor binding"]
    end

    subgraph L4 ["Layer 4: Infrastructure (Orchestrator)"]
        ORCH["Promise coalescing, debounce,<br/>session isolation via containers"]
    end

    subgraph L5 ["Layer 5: Persistence (Disk)"]
        DISK["Debounced single-writer persistence<br/>always writes latest state"]
    end

    L1 --> L2 --> L3 --> L4 --> L5
```

| Layer | Handles | Failure Mode Protected |
|---|---|---|
| **CRDT (Yjs)** | Concurrent text edits | Two users editing the same character |
| **y-websocket** | Network delivery | Dropped packets, reconnections |
| **Application Guards** | UI consistency | Editor feedback loops |
| **Orchestrator** | Resource management | Duplicate containers, orphaned sessions |
| **Debounced Persistence** | Disk I/O | Write conflicts, thrashing |

---

## 8. Collaborative Cursor Synchronization

### 8.1 How Cursors Are Shared

**File:** [useCollabCursors.js](file:///d:/coder-assist-main/coder-assist-main/editor/client/src/hooks/useCollabCursors.js)

Cursor sharing is separate from document synchronization and uses **Socket.IO** instead of Yjs:

```mermaid
sequenceDiagram
    participant A as User A (Browser)
    participant ORC as Orchestrator
    participant B as User B (Browser)
    participant C as User C (Browser)

    A->>ORC: cursor:move { file: "index.html", row: 5, col: 10 }
    ORC->>ORC: broadcastToSession (skip sender)
    ORC->>B: cursor:update { socketId: A, file, row:5, col:10 }
    ORC->>C: cursor:update { socketId: A, file, row:5, col:10 }

    Note over B,C: Render colored cursor marker at row=5, col=10
```

### 8.2 Cursor Cleanup on Disconnect

```javascript
socket.on('disconnect', () => {
    broadcastToSession('cursor:leave', { socketId: socket.id });
});

// Client-side handler:
const handleLeave = ({ socketId }) => {
    colorMap.delete(socketId);
    setRemoteCursors(prev => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
    });
};
```

This ensures **no ghost cursors** remain when a user disconnects.

---

## 9. Session Isolation — Containers as Boundaries

Each session runs in an **isolated Docker container**:

```mermaid
graph LR
    subgraph Session_A ["Session A (Container)"]
        FS_A["Filesystem A<br/>/workspace/"]
        PTY_A["Terminal A<br/>(pty process)"]
    end

    subgraph Session_B ["Session B (Container)"]
        FS_B["Filesystem B<br/>/workspace/"]
        PTY_B["Terminal B<br/>(pty process)"]
    end

    ORC["Orchestrator"] --> Session_A
    ORC --> Session_B

    style Session_A fill:#1a2744,stroke:#3b82f6,color:#e2e8f0
    style Session_B fill:#2a1a44,stroke:#8b5cf6,color:#e2e8f0
```

### How Isolation Prevents Cross-Session Interference

| Resource | Isolation Mechanism |
|---|---|
| **File System** | Each container has its own Docker volume (`coder-session-{id}:/workspace`) |
| **Terminal** | Each container spawns its own `pty` process |
| **Network** | Containers communicate only through the orchestrator proxy |
| **Yjs Documents** | Document names are prefixed with `sessionId/` — no cross-session sharing possible |

> [!NOTE]
> Concurrency concerns **within** a session are handled by Yjs CRDTs and application guards. Concurrency **between** sessions is eliminated entirely by container isolation — they simply cannot interact.

---

## 10. Edge Cases and Failure Recovery

### 10.1 Network Disconnection and Reconnection

```mermaid
sequenceDiagram
    participant A as User A
    participant YJS as Yjs Server

    A->>YJS: Connected, editing...
    Note over A: ❌ Network drops

    A->>A: Continues editing locally (Yjs Doc stores ops)
    Note over A: Offline edits accumulate in local Yjs doc

    A->>YJS: ✅ Reconnects
    YJS->>A: Server sends missing updates
    A->>YJS: Client sends buffered local updates

    Note over A,YJS: CRDT merge — all operations converge ✅
```

Yjs handles this automatically through its **state vector** protocol. Each client tracks what updates it has seen, and on reconnection, only missing updates are exchanged.

### 10.2 Container Crash Recovery

```javascript
// orchestrator/index.js — attachSession
} else {
    // Reconnect to existing container
    try {
        await waitForPort(9000, session.host, 5, 300);
        socket.emit('session:status', { status: 'ready', sessionId });
    } catch {
        // Container died → respawn automatically
        sessions.delete(sessionId);
        return attachSession(socket, sessionId, true);
    }
}
```

If a container becomes unresponsive, the orchestrator **automatically respawns it** and reconnects the user.

### 10.3 Ace Editor Delta Conversion Fallback

```javascript
// App.jsx — Yjs → Ace binding
try {
    // Precise delta application...
} catch {
    // Fallback: full document reset (safe but causes cursor jump)
    const pos = editor.getCursorPosition();
    aceSession.setValue(ytext.toString());
    editor.moveCursorToPosition(pos);
}
```

If a delta conversion fails (e.g., due to an unexpected document state), the system falls back to **replacing the entire editor content** from Yjs, then restoring the cursor position. This is safe because Yjs is always the source of truth.

---

## 11. Comparison: Traditional vs. Coder Buddy Approach

| Concern | Traditional (Locking/OT) | Coder Buddy (CRDT + Guards) |
|---|---|---|
| **Concurrent edits** | Pessimistic locks or OT transform | CRDT automatic merge (no locks) |
| **Infinite loops** | N/A (server-only editing) | `isApplyingRemote` boolean guard |
| **Duplicate resources** | Semaphores/mutexes | Promise coalescing (`spawning` Map) |
| **Write amplification** | Batch queue + worker | Debounced timer (500ms) |
| **Session isolation** | Database row-level locks | Docker container isolation |
| **Offline editing** | Not supported | Built-in (Yjs buffers ops locally) |
| **Convergence proof** | Complex (OT requires correct transform functions) | Mathematical guarantee (CRDT) |

---

## 12. Summary

The Coder Buddy project achieves safe multi-user concurrent editing through a **layered defense** strategy:

1. **CRDTs (Yjs)** eliminate the possibility of conflicting edits at the data structure level
2. **The `isApplyingRemote` guard** prevents infinite feedback loops in the bidirectional Ace ↔ Yjs binding
3. **Promise coalescing** prevents duplicate Docker containers when multiple sockets try to spawn the same session
4. **Debounced persistence** ensures disk writes are efficient and non-conflicting
5. **Container isolation** provides hard boundaries between sessions
6. **Grace period cleanup** prevents premature resource destruction on transient disconnections
7. **Yjs transactions** ensure atomic, all-or-nothing document operations

Together, these mechanisms ensure that **no data is lost, no edits conflict, and all users see a consistent document state** — even under adverse network conditions.
