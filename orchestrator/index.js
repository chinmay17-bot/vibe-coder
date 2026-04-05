const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const Docker = require('dockerode');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const { setupWSConnection, docs } = require('y-websocket/bin/utils');

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' } });
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(cors());
app.use(express.json());

// ── Yjs WebSocket server (CRDT sync) on port 1234 ──
const yjsServer = new WebSocketServer({ port: 1234 });
yjsServer.on('connection', (ws, req) => {
    const docName = decodeURIComponent(req.url?.slice(1).split('?')[0] || '');
    if (!docName) return ws.close();

    // setupWSConnection handles all Yjs sync protocol correctly
    setupWSConnection(ws, req, { docName, gc: true });

    // After connection, hook into the doc for file persistence
    setTimeout(() => {
        const doc = docs.get(docName);
        if (!doc) return;
        const onUpdate = () => scheduleFilePersist(docName);
        doc.on('update', onUpdate);
        ws.on('close', () => doc.off('update', onUpdate));
    }, 50);
});

// Persist Yjs doc content to the session container (debounced 500ms)
const persistDebounces = new Map();
async function scheduleFilePersist(docName) {
    if (persistDebounces.has(docName)) clearTimeout(persistDebounces.get(docName));
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
        try {
            await fetch(`http://${session.host}:9000/files/content-write`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content }),
            });
        } catch (err) {
            console.error(`[Yjs] Failed to persist ${docName}:`, err.message);
        }
    }, 500));
}
// sessionId -> { container, port, host }
const sessions = new Map();
// sessionId -> Set of socket ids sharing that session
const sessionSockets = new Map();
// Track in-progress spawns to prevent duplicate containers for the same session
const spawning = new Map();

// Ask the OS for a free port
function getFreePort() {
    return new Promise((resolve, reject) => {
        const net = require('net');
        const srv = net.createServer();
        srv.listen(0, () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

// Detect the compose network name dynamically
async function getNetworkName() {
    const networks = await docker.listNetworks();
    const match = networks.find(n =>
        n.Name.endsWith('_default') &&
        !['bridge', 'host', 'none'].includes(n.Name)
    );
    if (match) return match.Name;
    return null;
}

async function spawnContainer(sessionId) {
    const port = await getFreePort();
    const containerName = `coder-session-${sessionId}`;
    const networkName = await getNetworkName();

    // Remove any existing container with this name (from a previous failed attempt)
    try {
        const old = docker.getContainer(containerName);
        await old.remove({ force: true });
        console.log(`[Orchestrator] Removed stale container ${containerName}`);
    } catch (_) { /* didn't exist, that's fine */ }

    console.log(`[Orchestrator] Spawning container ${containerName} on port ${port}, network: ${networkName || 'host'}`);

    const hostConfig = {
        PortBindings: { '9000/tcp': [{ HostPort: String(port) }] },
        Binds: [`coder-session-${sessionId}:/workspace`],
        AutoRemove: true,
    };

    if (networkName) {
        hostConfig.NetworkMode = networkName;
    }

    const container = await docker.createContainer({
        Image: 'coder-buddy-editor-server',
        name: containerName,
        Env: [
            `USER_DIR=/workspace`,
            `FASTAPI_URL=${process.env.FASTAPI_URL || 'http://fastapi:8000'}`,
        ],
        HostConfig: hostConfig,
        ExposedPorts: { '9000/tcp': {} },
    });

    await container.start();
    console.log(`[Orchestrator] Container ${containerName} started`);

    // Get the container's IP on the shared network so we can reach it internally
    const info = await container.inspect();
    let containerHost = 'localhost';
    if (networkName && info.NetworkSettings.Networks[networkName]) {
        containerHost = info.NetworkSettings.Networks[networkName].IPAddress;
    }
    console.log(`[Orchestrator] Container IP: ${containerHost}:9000`);

    await waitForPort(9000, containerHost);

    return { container, port, host: containerHost };
}

function waitForPort(port, host = 'localhost', retries = 20, delay = 500) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
            const req = http.request({ host, port, path: '/files', method: 'GET' }, () => resolve());
            req.on('error', () => {
                attempts++;
                if (attempts >= retries) return reject(new Error(`${host}:${port} never became ready`));
                setTimeout(check, delay);
            });
            req.end();
        };
        check();
    });
}

async function destroySession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    try {
        await session.container.stop({ t: 2 });
        console.log(`[Orchestrator] Container for session ${sessionId} stopped`);
    } catch (e) {
        console.warn(`[Orchestrator] Could not stop container for ${sessionId}:`, e.message);
    }
}

// ── Session management endpoints ──

// List all active sessions
app.get('/sessions', async (req, res) => {
    try {
        const containers = await docker.listContainers();
        const sessionContainers = containers.filter(c =>
            c.Names.some(n => n.includes('coder-session'))
        );
        const list = sessionContainers.map(c => {
            const name = c.Names[0].replace('/', '');
            const sessionId = name.replace('coder-session-', '');
            return {
                sessionId,
                name,
                status: c.Status,
                created: c.Created,
                active: sessions.has(sessionId),
            };
        });
        res.json({ sessions: list });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete/stop a session
app.delete('/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    await destroySession(sessionId);
    // Also force-remove the container if it's still there
    try {
        const container = docker.getContainer(`coder-session-${sessionId}`);
        await container.remove({ force: true });
    } catch (_) {}
    res.json({ success: true });
});

// ── HTTP proxy: forward REST calls to the right container ──
// Client sends header X-Session-Id on every request
const PROXY_PATHS = ['/files'];
PROXY_PATHS.forEach(route => {
    app.use(route, async (req, res) => {
        const sessionId = req.headers['x-session-id'];
        const session = sessions.get(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const url = `http://${session.host}:9000${req.originalUrl}`;
        try {
            const fetchOpts = {
                method: req.method,
                headers: { 'Content-Type': 'application/json' },
            };
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                fetchOpts.body = JSON.stringify(req.body);
            }
            const upstream = await fetch(url, fetchOpts);
            const data = await upstream.json();
            res.status(upstream.status).json(data);
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
    });
});

// ── Preview proxy: forward raw content (not JSON) for live preview iframe ──
app.use('/preview', async (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.query.sid;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).send('Session not found');

    // Strip sid from the forwarded URL
    const urlObj = new URL(`http://localhost${req.originalUrl}`);
    urlObj.searchParams.delete('sid');
    const forwardUrl = `http://${session.host}:9000${urlObj.pathname}${urlObj.search}`;

    try {
        const upstream = await fetch(forwardUrl);
        const contentType = upstream.headers.get('content-type') || 'text/plain';
        res.status(upstream.status).setHeader('Content-Type', contentType);
        const buffer = await upstream.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(502).send(err.message);
    }
});
app.use('/preview', async (req, res) => {
    const sessionId = req.headers['x-session-id'];
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).send('Session not found');

    const url = `http://${session.host}:9000${req.originalUrl}`;
    try {
        const upstream = await fetch(url);
        const contentType = upstream.headers.get('content-type') || 'text/plain';
        const buffer = await upstream.arrayBuffer();
        res.setHeader('Content-Type', contentType);
        res.status(upstream.status).send(Buffer.from(buffer));
    } catch (err) {
        res.status(502).send(err.message);
    }
});

// ── Socket.IO: one namespace per session ──
io.on('connection', async (socket) => {
    console.log(`[Orchestrator] New connection: socket=${socket.id}`);

    // Client must send session:select or session:new to start
    socket.on('session:select', async (sessionId) => {
        await attachSession(socket, sessionId, false);
    });

    socket.on('session:new', async () => {
        const sessionId = require('crypto').randomUUID();
        await attachSession(socket, sessionId, true);
    });
});

async function attachSession(socket, sessionId, forceNew) {
    console.log(`[Orchestrator] Attaching session=${sessionId}, forceNew=${forceNew}`);

    let session = sessions.get(sessionId);

    if (!session || forceNew) {
        if (spawning.has(sessionId)) {
            try {
                socket.emit('session:status', { status: 'starting', sessionId });
                session = await spawning.get(sessionId);
                socket.emit('session:status', { status: 'ready', sessionId });
            } catch (err) {
                socket.emit('session:status', { status: 'error', message: err.message });
                return;
            }
        } else {
            try {
                socket.emit('session:status', { status: 'starting', sessionId });
                const spawnPromise = spawnContainer(sessionId);
                spawning.set(sessionId, spawnPromise);
                session = await spawnPromise;
                spawning.delete(sessionId);
                sessions.set(sessionId, session);
                socket.emit('session:status', { status: 'ready', sessionId });
                console.log(`[Orchestrator] Session ${sessionId} ready on port ${session.port}`);
            } catch (err) {
                spawning.delete(sessionId);
                console.error(`[Orchestrator] Failed to spawn container:`, err.message);
                socket.emit('session:status', { status: 'error', message: err.message });
                return;
            }
        }
    } else {
        // Reconnect to existing container
        try {
            await waitForPort(9000, session.host, 5, 300);
            socket.emit('session:status', { status: 'ready', sessionId });
        } catch {
            // Container died, respawn
            sessions.delete(sessionId);
            return attachSession(socket, sessionId, true);
        }
    }

    // Store sessionId on socket for cleanup
    socket.data.sessionId = sessionId;

    // Track all sockets sharing this session
    if (!sessionSockets.has(sessionId)) sessionSockets.set(sessionId, new Set());
    sessionSockets.get(sessionId).add(socket.id);

    // Helper: broadcast an event to all OTHER sockets in the same session
    const broadcastToSession = (event, data) => {
        const peers = sessionSockets.get(sessionId);
        if (!peers) return;
        for (const peerId of peers) {
            if (peerId === socket.id) continue;
            const peer = io.sockets.sockets.get(peerId);
            if (peer) peer.emit(event, data);
        }
    };

    // Forward all events to the session container via a proxy socket
    const { io: ioClient } = require('socket.io-client');
    const upstream = ioClient(`http://${session.host}:9000`);

    const FORWARD_TO_UPSTREAM = ['terminal:write', 'terminal:resize', 'file:change', 'ai:prompt', 'ai:edit', 'ai:chat'];
    const FORWARD_TO_CLIENT = ['terminal:data', 'file:refresh', 'ai:response', 'ai:file-created', 'ai:project-created'];

    FORWARD_TO_UPSTREAM.forEach(event => {
        socket.on(event, (data) => upstream.emit(event, data));
    });

    FORWARD_TO_CLIENT.forEach(event => {
        upstream.on(event, (data) => socket.emit(event, data));
    });

    // When this socket saves a file, notify peers to refresh their file tree and editor
    socket.on('file:change', (data) => {
        // Broadcast to peers: refresh file tree
        broadcastToSession('file:refresh', data.path);
        // Broadcast the actual content change so peers update their editor
        broadcastToSession('file:synced', data);
    });

    // Relay cursor position to all peers in the same session
    socket.on('cursor:move', (data) => {
        broadcastToSession('cursor:update', { ...data, socketId: socket.id });
    });

    socket.on('disconnect', async () => {
        console.log(`[Orchestrator] Socket ${socket.id} disconnected`);
        upstream.disconnect();
        // Notify peers this cursor is gone
        broadcastToSession('cursor:leave', { socketId: socket.id });
        // Remove from session group
        const peers = sessionSockets.get(sessionId);
        if (peers) {
            peers.delete(socket.id);
            if (peers.size === 0) sessionSockets.delete(sessionId);
        }
        setTimeout(async () => {
            const remaining = [...io.sockets.sockets.values()].filter(
                s => s.data.sessionId === sessionId
            );
            if (remaining.length === 0) {
                await destroySession(sessionId);
            }
        }, 5000);
    });
}

server.listen(3000, () => {
    console.log('[Orchestrator] Running on port 3000');
});
