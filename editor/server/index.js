// ==========================================
// 1. IMPORTS & DEPENDENCIES
// ==========================================
const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const cors = require('cors');
const containerManager = require('./containerManager');

// ==========================================
// 2. SERVER INITIALIZATION
// ==========================================
const app = express();
const server = http.createServer(app);

const io = new SocketServer(server, {
    cors: { origin: "*" }
});

app.use(cors());

// ==========================================
// 3. HTTP API ROUTES
// ==========================================

// File tree endpoint — requires sessionId query param
app.get('/files', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId query parameter' });
    }

    try {
        const tree = await containerManager.getFileTree(sessionId);
        return res.json({ tree });
    } catch (err) {
        console.error(`[Server] Error getting file tree for ${sessionId}:`, err.message);
        return res.status(500).json({ error: err.message });
    }
});

// File content endpoint — requires sessionId and path query params
app.get('/files/content', async (req, res) => {
    const sessionId = req.query.sessionId;
    const filePath = req.query.path;
    if (!sessionId || !filePath) {
        return res.status(400).json({ error: 'Missing sessionId or path query parameter' });
    }

    try {
        const content = await containerManager.getFileContent(sessionId, filePath);
        return res.json({ content });
    } catch (err) {
        console.error(`[Server] Error reading file for ${sessionId}:`, err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. SOCKET.IO — PER-SESSION CONTAINER LOGIC
// ==========================================
io.on('connection', async (socket) => {
    const sessionId = socket.id;
    console.log(`[Server] Socket connected: ${sessionId}`);

    // --- Provision a Docker container for this session ---
    try {
        socket.emit('session:status', { status: 'provisioning', message: 'Creating your workspace...' });

        const { containerId, containerName } = await containerManager.createSession(sessionId);
        console.log(`[Server] Container ready for ${sessionId}: ${containerName}`);

        // Notify client that the container is ready
        socket.emit('session:status', { status: 'ready', message: 'Workspace is ready!' });

        // --- Attach terminal ---
        const termStream = await containerManager.attachTerminal(sessionId);

        // FLOW 1: Container terminal → Client
        termStream.on('data', (data) => {
            socket.emit('terminal:data', data.toString());
        });

        // FLOW 2: Client → Container terminal
        socket.on('terminal:write', (data) => {
            termStream.write(data);
        });

        // --- File change from editor ---
        socket.on('file:change', async ({ path, content }) => {
            try {
                await containerManager.writeFile(sessionId, path, content);
                console.log(`[Server] File written: ${path} (session: ${sessionId})`);
            } catch (err) {
                console.error(`[Server] Error writing file:`, err.message);
                socket.emit('session:error', { message: `Failed to save file: ${err.message}` });
            }
        });

        // --- File tree refresh polling ---
        // Since chokidar can't watch inside a container, we poll periodically
        const FILE_POLL_INTERVAL_MS = 3000;
        const pollTimer = setInterval(async () => {
            try {
                // Only emit if session is still active
                if (containerManager.sessions.has(sessionId)) {
                    socket.emit('file:refresh');
                }
            } catch (_) {
                // Ignore errors during polling
            }
        }, FILE_POLL_INTERVAL_MS);

        // --- Cleanup on disconnect ---
        socket.on('disconnect', async () => {
            console.log(`[Server] Socket disconnected: ${sessionId}`);
            clearInterval(pollTimer);
            await containerManager.destroySession(sessionId);
        });

    } catch (err) {
        console.error(`[Server] Failed to create session for ${sessionId}:`, err.message);
        socket.emit('session:status', { status: 'error', message: `Failed to create workspace: ${err.message}` });
    }
});

// ==========================================
// 5. GRACEFUL SHUTDOWN
// ==========================================
async function shutdown() {
    console.log('\n[Server] Shutting down... destroying all containers.');
    await containerManager.destroyAll();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ==========================================
// 6. START UP
// ==========================================
server.listen(9000, () => {
    console.log('[Server] Orchestrator running on http://localhost:9000');
    console.log('[Server] Each socket connection will get its own Docker container.');
});