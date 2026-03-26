// ==========================================
// ContainerManager — Docker container lifecycle for per-user sessions
// ==========================================
// Each socket connection gets its own Docker container with an isolated
// filesystem and terminal. This module wraps dockerode to manage that.

const Docker = require('dockerode');
const { PassThrough } = require('stream');

const docker = new Docker(); // Connects via default socket (/var/run/docker.sock or npipe)

const IMAGE_NAME = 'coder-workspace';

// Container resource limits
const CONTAINER_LIMITS = {
    Memory: 256 * 1024 * 1024,  // 256 MB
    CpuShares: 512,             // Relative CPU weight
    PidsLimit: 50,              // Max processes
};

// Idle timeout before auto-destroying a container (30 minutes)
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Active sessions: sessionId -> { container, containerId, idleTimer, termExec, termStream }
const sessions = new Map();

/**
 * Create and start a new Docker container for a session.
 * @param {string} sessionId — Unique session identifier (e.g. socket.id)
 * @returns {{ containerId: string, containerName: string }}
 */
async function createSession(sessionId) {
    const containerName = `coder-session-${sessionId}`;

    const container = await docker.createContainer({
        Image: IMAGE_NAME,
        name: containerName,
        Tty: true,
        OpenStdin: true,
        HostConfig: {
            Memory: CONTAINER_LIMITS.Memory,
            CpuShares: CONTAINER_LIMITS.CpuShares,
            PidsLimit: CONTAINER_LIMITS.PidsLimit,
            // No network access for security (optional — comment out if users need internet)
            // NetworkMode: 'none',
        },
        WorkingDir: '/workspace',
    });

    await container.start();

    const session = {
        container,
        containerId: container.id,
        containerName,
        idleTimer: null,
        termExec: null,
        termStream: null,
    };

    sessions.set(sessionId, session);
    resetIdleTimer(sessionId);

    console.log(`[ContainerManager] Created container ${containerName} (${container.id.slice(0, 12)})`);
    return { containerId: container.id, containerName };
}

/**
 * Attach an interactive terminal (bash) inside the container.
 * Returns a duplex stream for reading/writing terminal I/O.
 * @param {string} sessionId
 * @returns {import('stream').Duplex} — Terminal I/O stream
 */
async function attachTerminal(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    resetIdleTimer(sessionId);

    const exec = await session.container.exec({
        Cmd: ['bash'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
    });

    const stream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true,
    });

    session.termExec = exec;
    session.termStream = stream;

    return stream;
}

/**
 * Get the file tree from a container's /workspace directory.
 * @param {string} sessionId
 * @returns {object} — Nested object representing the file tree
 */
async function getFileTree(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    resetIdleTimer(sessionId);

    // BusyBox find (Alpine) doesn't support -printf, so use sh -c with a compatible script
    const findScript = [
        'find /workspace',
        '\\( -name ".*" -o -name node_modules -o -name __pycache__ -o -name venv \\) -prune -o',
        '-not -name "package-lock.json" -not -name "yarn.lock" -not -name "pnpm-lock.yaml"',
        '-print',
        '| while IFS= read -r f; do',
        '  rel="${f#/workspace/}";',
        '  [ "$f" = "/workspace" ] && continue;',
        '  [ -d "$f" ] && echo "d $rel" || echo "f $rel";',
        'done',
    ].join(' ');

    const output = await execCommand(session.container, ['sh', '-c', findScript]);

    const tree = {};
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
        const type = line[0];        // 'f' for file, 'd' for directory
        const relPath = line.slice(2); // path relative to /workspace

        if (!relPath) continue; // skip the root /workspace itself

        const parts = relPath.split('/');
        let current = tree;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                // Leaf node
                if (type === 'd') {
                    if (!current[part]) current[part] = {};
                } else {
                    current[part] = null; // file
                }
            } else {
                // Intermediate directory
                if (!current[part]) current[part] = {};
                current = current[part];
            }
        }
    }

    return tree;
}

/**
 * Read file content from a container.
 * @param {string} sessionId
 * @param {string} filePath — Path relative to /workspace (e.g. '/src/index.js')
 * @returns {string}
 */
async function getFileContent(sessionId, filePath) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    resetIdleTimer(sessionId);

    const fullPath = `/workspace${filePath}`;
    const content = await execCommand(session.container, ['cat', fullPath]);
    return content;
}

/**
 * Write content to a file inside the container.
 * @param {string} sessionId
 * @param {string} filePath — Path relative to /workspace
 * @param {string} content — File content to write
 */
async function writeFile(sessionId, filePath, content) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    resetIdleTimer(sessionId);

    const fullPath = `/workspace${filePath}`;

    // Ensure parent directory exists, then write
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await execCommand(session.container, ['mkdir', '-p', dir]);

    // Use sh -c with heredoc-style write to handle special characters
    const exec = await session.container.exec({
        Cmd: ['sh', '-c', `cat > '${fullPath}'`],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    return new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.write(content);
        stream.end();
        // Wait a moment for the write to complete
        setTimeout(resolve, 100);
    });
}

/**
 * Stop and remove a container, cleaning up the session.
 * @param {string} sessionId
 */
async function destroySession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Clear idle timer
    if (session.idleTimer) {
        clearTimeout(session.idleTimer);
    }

    // Close terminal stream if open
    if (session.termStream) {
        try { session.termStream.end(); } catch (_) {}
    }

    try {
        await session.container.stop({ t: 2 }); // 2 second grace period
    } catch (err) {
        // Container might already be stopped
        if (err.statusCode !== 304) {
            console.error(`[ContainerManager] Error stopping container: ${err.message}`);
        }
    }

    try {
        await session.container.remove({ force: true });
    } catch (err) {
        console.error(`[ContainerManager] Error removing container: ${err.message}`);
    }

    sessions.delete(sessionId);
    console.log(`[ContainerManager] Destroyed session ${sessionId}`);
}

/**
 * Destroy all active sessions (for graceful shutdown).
 */
async function destroyAll() {
    const promises = [];
    for (const sessionId of sessions.keys()) {
        promises.push(destroySession(sessionId));
    }
    await Promise.allSettled(promises);
    console.log('[ContainerManager] All sessions destroyed.');
}

// ==========================================
// Internal helpers
// ==========================================

/**
 * Execute a command inside a container and return stdout as a string.
 */
async function execCommand(container, cmd) {
    const exec = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
    });

    const stream = await exec.start();

    return new Promise((resolve, reject) => {
        const chunks = [];
        const output = new PassThrough();

        // dockerode streams may be multiplexed; demux if needed
        container.modem.demuxStream(stream, output, output);

        output.on('data', (chunk) => chunks.push(chunk));
        output.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        output.on('error', reject);
        stream.on('end', () => output.end());
    });
}

/**
 * Reset the idle timer for a session. If no activity happens within
 * IDLE_TIMEOUT_MS, the container is automatically destroyed.
 */
function resetIdleTimer(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    if (session.idleTimer) {
        clearTimeout(session.idleTimer);
    }

    session.idleTimer = setTimeout(async () => {
        console.log(`[ContainerManager] Session ${sessionId} timed out after ${IDLE_TIMEOUT_MS / 1000}s idle`);
        await destroySession(sessionId);
    }, IDLE_TIMEOUT_MS);
}

// ==========================================
// Exports
// ==========================================
module.exports = {
    createSession,
    attachTerminal,
    getFileTree,
    getFileContent,
    writeFile,
    destroySession,
    destroyAll,
    sessions, // Exposed for debugging/monitoring
};
