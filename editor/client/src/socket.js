import { io } from 'socket.io-client';

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL || 'http://localhost:3000';
const socket = io(ORCHESTRATOR_URL);

export default socket;
