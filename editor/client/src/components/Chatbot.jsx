import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import './Chatbot.css';

const AGENT_COLORS = {
    planner: '#8b5cf6',
    architect: '#3b82f6',
    coder: '#10b981',
    system: '#6b7280',
    user: '#f59e0b'
};

const AGENT_LABELS = {
    planner: '📋 Planner',
    architect: '🏗️ Architect',
    coder: '💻 Coder',
    system: '⚙️ System',
    user: '👤 You'
};

const Chatbot = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Listen for AI responses
    useEffect(() => {
        const handleResponse = (data) => {
            setMessages(prev => {
                const newMessages = [...prev];

                // If last message is from the same agent and still working, append
                const last = newMessages[newMessages.length - 1];
                if (last && last.agent === data.agent && last.agent !== 'user' && data.status === 'working') {
                    // Replace the last message content with new content
                    newMessages[newMessages.length - 1] = {
                        ...last,
                        content: data.content || last.content,
                        plan: data.plan || last.plan,
                        task_plan: data.task_plan || last.task_plan,
                    };
                } else {
                    // Add new message
                    newMessages.push({
                        agent: data.agent,
                        content: data.content || '',
                        status: data.status,
                        plan: data.plan || null,
                        task_plan: data.task_plan || null,
                        timestamp: new Date()
                    });
                }

                return newMessages;
            });

            // Stop loading when complete or error
            if (data.status === 'complete' || data.status === 'error') {
                setIsLoading(false);
            }
        };

        const handleFileCreated = (data) => {
            setMessages(prev => [...prev, {
                agent: 'system',
                content: `📁 File created: **${data.path}** — check the file tree!`,
                status: 'info',
                timestamp: new Date()
            }]);
        };

        const handleProjectCreated = (data) => {
            setMessages(prev => [...prev, {
                agent: 'system',
                content: `📂 New project folder created: **${data.folder}/**`,
                status: 'info',
                timestamp: new Date()
            }]);
        };

        socket.on('ai:response', handleResponse);
        socket.on('ai:file-created', handleFileCreated);
        socket.on('ai:project-created', handleProjectCreated);

        return () => {
            socket.off('ai:response', handleResponse);
            socket.off('ai:file-created', handleFileCreated);
            socket.off('ai:project-created', handleProjectCreated);
        };
    }, []);

    const handleSend = () => {
        const prompt = input.trim();
        if (!prompt || isLoading) return;

        // Add user message
        setMessages(prev => [...prev, {
            agent: 'user',
            content: prompt,
            status: 'sent',
            timestamp: new Date()
        }]);

        // Send to server
        socket.emit('ai:prompt', prompt);
        setIsLoading(true);
        setInput('');
        inputRef.current?.focus();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const renderContent = (msg) => {
        // Render plan details
        if (msg.plan) {
            return (
                <div className="msg-content">
                    <p>{msg.content}</p>
                    <div className="plan-card">
                        <h4>🎯 {msg.plan.name}</h4>
                        <p className="plan-desc">{msg.plan.description}</p>
                        <div className="plan-meta">
                            <span className="plan-badge">Tech: {msg.plan.techstack}</span>
                        </div>
                        {msg.plan.features && (
                            <div className="plan-features">
                                <strong>Features:</strong>
                                <ul>{msg.plan.features.map((f, i) => <li key={i}>{f}</li>)}</ul>
                            </div>
                        )}
                        {msg.plan.files && (
                            <div className="plan-files">
                                <strong>Files:</strong>
                                <ul>{msg.plan.files.map((f, i) => <li key={i}><code>{f.path}</code> — {f.purpose}</li>)}</ul>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // Render task plan details
        if (msg.task_plan) {
            return (
                <div className="msg-content">
                    <p>{msg.content}</p>
                    <div className="plan-card">
                        <h4>📐 Implementation Steps</h4>
                        <ol className="task-steps">
                            {msg.task_plan.steps.map((s, i) => (
                                <li key={i}><code>{s.filepath}</code> — {s.task}</li>
                            ))}
                        </ol>
                    </div>
                </div>
            );
        }

        // Render code content with basic formatting
        if (msg.content && msg.content.includes('```')) {
            const parts = msg.content.split(/(```[\s\S]*?```)/g);
            return (
                <div className="msg-content">
                    {parts.map((part, i) => {
                        if (part.startsWith('```')) {
                            const codeContent = part.replace(/```\w*\n?/, '').replace(/```$/, '');
                            return <pre key={i} className="code-block"><code>{codeContent}</code></pre>;
                        }
                        return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
                    })}
                </div>
            );
        }

        return <div className="msg-content"><span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span></div>;
    };

    return (
        <div className="chatbot">
            <div className="chatbot-header">
                <span className="chatbot-title">🤖 AI Assistant</span>
                {isLoading && <span className="chatbot-status">Working...</span>}
            </div>

            <div className="chatbot-messages">
                {messages.length === 0 && (
                    <div className="chatbot-empty">
                        <p>💡 Describe what you want to build.</p>
                        <p className="chatbot-hint">The AI will plan, architect, and code it for you. Generated files will appear in the file tree.</p>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`chat-message ${msg.agent}`}>
                        <div className="msg-header">
                            <span
                                className="agent-label"
                                style={{ backgroundColor: AGENT_COLORS[msg.agent] || '#6b7280' }}
                            >
                                {AGENT_LABELS[msg.agent] || msg.agent}
                            </span>
                        </div>
                        {renderContent(msg)}
                    </div>
                ))}

                {isLoading && (
                    <div className="chat-message system loading-msg">
                        <div className="typing-indicator">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="chatbot-input-area">
                <textarea
                    ref={inputRef}
                    className="chatbot-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe what you want to build..."
                    rows={2}
                    disabled={isLoading}
                />
                <button
                    className="chatbot-send"
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                >
                    {isLoading ? '⏳' : '🚀'}
                </button>
            </div>
        </div>
    );
};

export default Chatbot;
