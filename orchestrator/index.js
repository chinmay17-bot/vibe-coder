const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const { createProxyMiddleware } = require('http-proxy-middleware');
const Docker = require('dockerode');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' } });
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(cors());
app.use(express.json());

// sessionId -> { container, port }
const sessions = new Map();
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
    const match = networks.find(n => n.Name.endsWith('_default') && n.Name.includes('coder'));
    if (match) return match.Name;
    // fallback: just use host networking
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

// ── HTTP proxy: forward REST calls to the right container ──
// Client sends header X-Session-Id on every request
app.use('/files', (req, res, next) => {
    const sessionId = req.headers['x-session-id'];
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    createProxyMiddleware({
        target: `http://${session.host}:9000`,
        changeOrigin: true,
        on: { error: (err) => res.status(502).json({ error: err.message }) },
    })(req, res, next);
});

// ── Socket.IO: one namespace per session ──
io.on('connection', async (socket) => {
    const sessionId = socket.handshake.query.sessionId || socket.id;
    console.log(`[Orchestrator] New connection: socket=${socket.id}, session=${sessionId}`);

    let session = sessions.get(sessionId);

    if (!session) {
        // If already spawning for this session, wait for it
        if (spawning.has(sessionId)) {
            try {
                socket.emit('session:status', { status: 'starting' });
                session = await spawning.get(sessionId);
                socket.emit('session:status', { status: 'ready', port: session.port });
            } catch (err) {
                socket.emit('session:status', { status: 'error', message: err.message });
                socket.disconnect();
                return;
            }
        } else {
            try {
                socket.emit('session:status', { status: 'starting' });
                const spawnPromise = spawnContainer(sessionId);
                spawning.set(sessionId, spawnPromise);
                session = await spawnPromise;
                spawning.delete(sessionId);
                sessions.set(sessionId, session);
                socket.emit('session:status', { status: 'ready', port: session.port });
                console.log(`[Orchestrator] Session ${sessionId} ready on port ${session.port}`);
            } catch (err) {
                spawning.delete(sessionId);
                console.error(`[Orchestrator] Failed to spawn container:`, err.message);
                socket.emit('session:status', { status: 'error', message: err.message });
                socket.disconnect();
                return;
            }
        }
    } else {
        socket.emit('session:status', { status: 'ready', port: session.port });
    }

    // Forward all events to the session container via a proxy socket
    const { io: ioClient } = require('socket.io-client');
    const upstream = ioClient(`http://${session.host}:9000`);

    const FORWARD_TO_UPSTREAM = ['terminal:write', 'terminal:resize', 'file:change', 'ai:prompt'];
    const FORWARD_TO_CLIENT = ['terminal:data', 'file:refresh', 'ai:response', 'ai:file-created', 'ai:project-created'];

    FORWARD_TO_UPSTREAM.forEach(event => {
        socket.on(event, (data) => upstream.emit(event, data));
    });

    FORWARD_TO_CLIENT.forEach(event => {
        upstream.on(event, (data) => socket.emit(event, data));
    });

    socket.on('disconnect', async () => {
        console.log(`[Orchestrator] Socket ${socket.id} disconnected`);
        upstream.disconnect();
        // Delay destruction to handle React StrictMode double-mount and brief reconnects
        setTimeout(async () => {
            const remaining = [...io.sockets.sockets.values()].filter(
                s => s.handshake.query.sessionId === sessionId
            );
            if (remaining.length === 0) {
                await destroySession(sessionId);
            }
        }, 5000);
    });
});

server.listen(3000, () => {
    console.log('[Orchestrator] Running on port 3000');
});
