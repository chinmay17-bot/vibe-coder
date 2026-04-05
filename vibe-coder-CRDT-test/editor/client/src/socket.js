import { io } from 'socket.io-client';

// In local dev mode, connect directly to the editor server on port 9000.
// In Docker/orchestrator mode, connect to the orchestrator on port 3000.
const ORCHESTRATOR_URL = 'http://localhost:3000';
const EDITOR_SERVER_URL = 'http://localhost:9000';

// Auto-detect: try orchestrator first, fall back to direct editor server
let serverUrl = EDITOR_SERVER_URL;

// Check if orchestrator is available (non-blocking)
const checkOrchestrator = async () => {
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${ORCHESTRATOR_URL}/sessions`, { signal: controller.signal });
        if (res.ok) {
            serverUrl = ORCHESTRATOR_URL;
            console.log('[Socket] Using orchestrator on port 3000');
        }
    } catch {
        console.log('[Socket] Orchestrator not available, using direct editor server on port 9000');
    }
};

// We start by connecting to the editor server directly
// (the orchestrator path is for Docker deployment)
const socket = io(EDITOR_SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
});

socket.on('connect', () => {
    console.log('[Socket] Connected to', EDITOR_SERVER_URL);
});

socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
});

export const getServerUrl = () => serverUrl;
export const API_BASE = EDITOR_SERVER_URL;
export default socket;
