// Runtime config — reads from window.__ENV__ injected by Nginx,
// falls back to Vite build-time env vars, then localhost defaults
const env = window.__ENV__ || {};

export const ORCHESTRATOR_URL = env.VITE_ORCHESTRATOR_URL 
    || import.meta.env.VITE_ORCHESTRATOR_URL 
    || 'http://localhost:3000';

export const YJS_URL = env.VITE_YJS_URL 
    || import.meta.env.VITE_YJS_URL 
    || 'ws://localhost:1234';
