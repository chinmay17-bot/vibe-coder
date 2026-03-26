import {io} from 'socket.io-client'

const socket = io('http://localhost:9000')

// Export a promise that resolves when the session is ready
export const sessionReady = new Promise((resolve) => {
    socket.on('session:status', (data) => {
        if (data.status === 'ready') {
            resolve(socket.id);
        }
    });
});

export default socket;