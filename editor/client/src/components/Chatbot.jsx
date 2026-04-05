import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import './Chatbot.css';

const AGENT_COLORS = {
    planner: '#8b5cf6',
    architect: '#3b82f6',
    coder: '#10b981',
    assistant: '#58a6ff',
    system: '#6b7280',
    user: '#f59e0b'
};

const AGENT_LABELS = {
    planner: '📋 Planner',
    architect: '🏗️ Architect',
    coder: '💻 Coder',
    assistant: '🤖 Assistant',
    system: '⚙️ System',
    user: '👤 You'
};

// Keywords that indicate the user wants to BUILD a project from scratch
const BUILD_KEYWORDS = /^(build|create|make|generate|develop|write|code|design)\s/i;

const Chatbot = ({ selectedFile, code, fileTree }) => {
    const STORAGE_KEY = `coder-buddy-chat-${sessionStorage.getItem('sessionId') || 'default'}`;

    // Load saved messages from localStorage
    const loadSavedMessages = () => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
            }
        } catch (e) {
            console.warn('Failed to load chat history:', e);
        }
        return [];
    };

    const [messages, setMessages] = useState(loadSavedMessages);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Persist messages to localStorage whenever they change
    useEffect(() => {
        try {
            const toSave = messages.map(m => ({
                agent: m.agent,
                content: m.content,
                status: m.status,
                timestamp: m.timestamp,
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        } catch (e) {
            console.warn('Failed to save chat history:', e);
        }
    }, [messages, STORAGE_KEY]);

    const clearHistory = () => {
        setMessages([]);
        localStorage.removeItem(STORAGE_KEY);
    };

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
                    newMessages[newMessages.length - 1] = {
                        ...last,
                        content: data.content || last.content,
                        plan: data.plan || last.plan,
                        task_plan: data.task_plan || last.task_plan,
                    };
                } else {
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

        if (BUILD_KEYWORDS.test(prompt) && !selectedFile) {
            // Build mode — only when NO file is open (otherwise it's a chat modification)
            socket.emit('ai:prompt', prompt);
        } else {
            // Chat mode — conversational Q&A OR code modification (auto-detected by the agent)
            socket.emit('ai:chat', {
                message: prompt,
                fileContext: selectedFile ? { path: selectedFile, content: code || '' } : null,
                fileTree: fileTree ? JSON.stringify(fileTree) : null,
            });
        }

        setIsLoading(true);
        setInput('');
        inputRef.current?.focus();
    };

    // Quick action buttons — send pre-crafted prompts with file context
    const sendQuickAction = (action) => {
        if (isLoading) return;

        const fileName = selectedFile ? selectedFile.split('/').pop() : 'the code';
        const prompts = {
            explain: `Explain what ${fileName} does. Walk me through the code step by step.`,
            fix: `Find bugs or errors in ${fileName} and suggest fixes.`,
            improve: `Suggest improvements for ${fileName} — performance, readability, best practices.`,
            run: `How do I run or test ${fileName}? Give me step-by-step instructions.`,
        };

        const prompt = prompts[action];
        if (!prompt) return;

        setMessages(prev => [...prev, {
            agent: 'user',
            content: prompt,
            status: 'sent',
            timestamp: new Date()
        }]);

        socket.emit('ai:chat', {
            message: prompt,
            fileContext: selectedFile ? { path: selectedFile, content: code || '' } : null,
            fileTree: fileTree ? JSON.stringify(fileTree) : null,
        });

        setIsLoading(true);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const getLangBadgeColor = (techstack) => {
        const ts = (techstack || '').toLowerCase();
        if (ts.includes('python')) return '#3572A5';
        if (ts.includes('c++') || ts.includes('cpp')) return '#f34b7d';
        if (ts.includes('java') && !ts.includes('javascript')) return '#b07219';
        if (ts.includes('c ') || ts === 'c') return '#555555';
        return '#58a6ff';
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
                            <span className="plan-badge" style={{ backgroundColor: getLangBadgeColor(msg.plan.techstack), color: '#fff' }}>
                                {msg.plan.techstack}
                            </span>
                            <span className="plan-badge">{msg.plan.files?.length || 0} file(s)</span>
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
                <div className="chatbot-header-actions">
                    {messages.length > 0 && (
                        <button
                            className="chatbot-clear-btn"
                            onClick={clearHistory}
                            title="Clear conversation history"
                        >
                            🗑️ Clear
                        </button>
                    )}
                    {isLoading && <span className="chatbot-status">Working...</span>}
                </div>
            </div>

            <div className="chatbot-messages">
                {messages.length === 0 && (
                    <div className="chatbot-empty">
                        <p>💡 Ask me anything or describe what you want to build.</p>
                        <p className="chatbot-hint">
                            I can answer questions, explain code, build projects, and edit files.
                        </p>


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

            {/* Quick action buttons — visible when a file is open */}
            {selectedFile && (
                <div className="chat-quick-actions">
                    <button onClick={() => sendQuickAction('explain')} disabled={isLoading} title="Explain this code">
                        💡 Explain
                    </button>
                    <button onClick={() => sendQuickAction('fix')} disabled={isLoading} title="Find and fix bugs">
                        🔧 Fix
                    </button>
                    <button onClick={() => sendQuickAction('improve')} disabled={isLoading} title="Suggest improvements">
                        ✨ Improve
                    </button>
                    <button onClick={() => sendQuickAction('run')} disabled={isLoading} title="How to run this file">
                        ▶️ Run
                    </button>
                </div>
            )}

            <div className="chatbot-input-area">
                <textarea
                    ref={inputRef}
                    className="chatbot-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask anything or describe what to build..."
                    rows={2}
                    disabled={isLoading}
                />
                <div className="chatbot-actions">

                    <button
                        className="chatbot-send"
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                    >
                        {isLoading ? '⏳' : '🚀'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Chatbot;
