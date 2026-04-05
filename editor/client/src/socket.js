import { io } from 'socket.io-client';
import { ORCHESTRATOR_URL } from './config';

const socket = io(ORCHESTRATOR_URL);

export default socket;
