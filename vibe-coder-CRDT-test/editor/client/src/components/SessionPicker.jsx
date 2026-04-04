import { useEffect, useState } from 'react';
import socket from '../socket';
import './SessionPicker.css';

const SessionPicker = ({ onSessionReady }) => {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    const fetchSessions = async () => {
        try {
            const res = await fetch('http://localhost:3000/sessions');
            const data = await res.json();
            setSessions(data.sessions || []);
        } catch {
            setSessions([]);
        }
    };

    useEffect(() => {
        fetchSessions();

        socket.on('session:status', ({ status, sessionId, message }) => {
            if (status === 'starting') {
                setStatusMsg('Starting container...');
            } else if (status === 'ready') {
                sessionStorage.setItem('sessionId', sessionId);
                onSessionReady(sessionId);
            } else if (status === 'error') {
                setStatusMsg(`Error: ${message}`);
                setLoading(false);
            }
        });

        return () => socket.off('session:status');
    }, []);

    const handleSelect = (sessionId) => {
        setLoading(true);
        setStatusMsg('Connecting...');
        socket.emit('session:select', sessionId);
    };

    const handleNew = () => {
        setLoading(true);
        setStatusMsg('Spawning new container...');
        socket.emit('session:new');
    };

    const handleDelete = async (e, sessionId) => {
        e.stopPropagation();
        await fetch(`http://localhost:3000/sessions/${sessionId}`, { method: 'DELETE' });
        fetchSessions();
    };

    return (
        <div className="picker-root">
            <div className="picker-card">
                <div className="picker-logo">⚡</div>
                <h2 className="picker-title">Coder Buddy</h2>
                <p className="picker-subtitle">Choose a workspace or start a new one</p>

                {loading ? (
                    <div className="picker-loading">
                        <div className="picker-spinner" />
                        <span>{statusMsg}</span>
                    </div>
                ) : (
                    <>
                        <button className="picker-new-btn" onClick={handleNew}>
                            + New Session
                        </button>

                        {sessions.length > 0 && (
                            <div className="picker-sessions">
                                <p className="picker-label">Running sessions</p>
                                {sessions.map(s => (
                                    <div
                                        key={s.sessionId}
                                        className="picker-session-item"
                                        onClick={() => handleSelect(s.sessionId)}
                                    >
                                        <div className="picker-session-info">
                                            <span className="picker-dot" />
                                            <span className="picker-session-name">{s.name}</span>
                                            <span className="picker-session-status">{s.status}</span>
                                        </div>
                                        <button
                                            className="picker-delete-btn"
                                            onClick={(e) => handleDelete(e, s.sessionId)}
                                            title="Stop container"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default SessionPicker;
