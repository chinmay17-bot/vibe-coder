import { io } from 'socket.io-client';

// Generate a stable session ID for this browser tab.
// sessionStorage is tab-scoped — each tab gets its own ID.
let sessionId = sessionStorage.getItem('sessionId');
if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('sessionId', sessionId);
}

const socket = io('http://localhost:3000', {
    query: { sessionId },
});

export { sessionId };
export default socket;
