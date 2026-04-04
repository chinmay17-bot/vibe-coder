/* ============================================
   AI DevTeam Workspace — Client-Side Logic
   Handles SSE streaming & real-time UI updates
   ============================================ */

// --- STATE ---
const state = {
    isGenerating: false,
    isRunning: false,
    files: {},          // { filename: { code, language } }
    activeCodeFile: null,
    projectFiles: { html: '', css: '', js: '' },
    editor: null,       // CodeMirror instance
};

// Agent metadata
const AGENTS = {
    planner: { icon: '🧠', label: 'Planner', color: 'planner' },
    architect: { icon: '📐', label: 'Architect', color: 'architect' },
    coder: { icon: '💻', label: 'Coder', color: 'coder' },
    system: { icon: '✅', label: 'System', color: 'system' },
    user: { icon: '👤', label: 'You', color: 'user' },
};

// --- DOM REFS ---
const dom = {
    promptInput: document.getElementById('prompt-input'),
    sendBtn: document.getElementById('send-btn'),
    activityFeed: document.getElementById('activity-feed'),
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.querySelector('.status-text'),
    filesList: document.getElementById('files-list'),
    planDetails: document.getElementById('plan-details'),
    planContent: document.getElementById('plan-content'),
    archDetails: document.getElementById('arch-details'),
    archContent: document.getElementById('arch-content'),
    codeFileTabs: document.getElementById('code-file-tabs'),
    editorContainer: document.getElementById('editor-container'),
    previewIframe: document.getElementById('preview-iframe'),
    previewEmpty: document.getElementById('preview-empty'),
    workspaceTabs: document.getElementById('workspace-tabs'),
    runBtn: document.getElementById('run-btn'),
    terminalOutput: document.getElementById('terminal-output'),
    terminalClearBtn: document.getElementById('terminal-clear-btn'),
};

// --- CODEMIRROR LANGUAGE MAP ---
function getCodemirrorMode(language) {
    const map = {
        html: 'htmlmixed', htm: 'htmlmixed',
        css: 'css',
        javascript: 'javascript', js: 'javascript',
        python: 'python',
        json: { name: 'javascript', json: true },
        markdown: 'markdown', md: 'markdown',
        c: 'text/x-csrc', cpp: 'text/x-c++src',
        java: 'text/x-java',
        markup: 'htmlmixed',
        typescript: 'javascript',
    };
    return map[language] || 'htmlmixed';
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize CodeMirror
    state.editor = CodeMirror(dom.editorContainer, {
        value: '// Generated code will appear here...\n// Edit the code and click ▶ Run to execute.',
        theme: 'material-darker',
        lineNumbers: true,
        matchBrackets: true,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        lineWrapping: false,
        readOnly: false,
        extraKeys: {
            'Tab': (cm) => cm.replaceSelection('    ', 'end'),
        },
    });

    // Sync editor changes back to state
    state.editor.on('change', () => {
        if (state.activeCodeFile && state.files[state.activeCodeFile]) {
            const newCode = state.editor.getValue();
            state.files[state.activeCodeFile].code = newCode;

            // Update projectFiles for live preview
            const ext = state.activeCodeFile.split('.').pop().toLowerCase();
            if (ext === 'html' || ext === 'htm') {
                state.projectFiles.html = newCode;
            } else if (ext === 'css') {
                state.projectFiles.css = newCode;
            } else if (ext === 'js' || ext === 'mjs') {
                state.projectFiles.js = newCode;
            }
        }
    });

    dom.sendBtn.addEventListener('click', handleSend);
    dom.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Tab switching
    dom.workspaceTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        switchTab(btn.dataset.tab);
    });

    // Run button
    dom.runBtn.addEventListener('click', runCode);

    // Terminal clear
    dom.terminalClearBtn.addEventListener('click', () => {
        dom.terminalOutput.textContent = 'Run code to see output here...';
        dom.terminalOutput.className = 'terminal-output';
    });
});

// --- TAB SWITCHING ---
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`content-${tabName}`).classList.add('active');

    // Refresh CodeMirror when switching to code tab (fixes rendering glitch)
    if (tabName === 'code' && state.editor) {
        setTimeout(() => state.editor.refresh(), 10);
    }
}

// --- SEND PROMPT ---
async function handleSend() {
    const prompt = dom.promptInput.value.trim();
    if (!prompt || state.isGenerating) return;

    state.isGenerating = true;
    dom.sendBtn.disabled = true;
    dom.promptInput.value = '';

    // Clear previous state
    resetAll();

    // Add user message to feed
    addActivityCard('user', 'Your Request', prompt, false);

    // Update status
    setStatus('working', 'Agents working...');

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        handleAgentEvent(data);
                    } catch (err) {
                        console.warn('Failed to parse SSE data:', line, err);
                    }
                }
            }
        }
    } catch (err) {
        addActivityCard('system', 'Error', `❌ ${err.message}`, false);
    } finally {
        state.isGenerating = false;
        dom.sendBtn.disabled = false;
        setStatus('idle', 'Ready');

        // Mark pipeline done
        activatePipelineStep('done');

        // Final preview update
        updateLivePreview();
    }
}

// --- RUN CODE ---
async function runCode() {
    if (state.isRunning) return;

    const filename = state.activeCodeFile;
    if (!filename || !state.files[filename]) {
        dom.terminalOutput.textContent = '⚠️ No file selected. Generate code first, then select a file to run.';
        dom.terminalOutput.className = 'terminal-output terminal-error';
        return;
    }

    // Get latest code from editor
    const code = state.editor.getValue();
    const ext = filename.split('.').pop().toLowerCase();

    const langMap = {
        py: 'python', js: 'javascript', mjs: 'javascript',
        cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', java: 'java',
    };

    const language = langMap[ext];
    if (!language) {
        dom.terminalOutput.textContent = `⚠️ Cannot run .${ext} files. Supported: .py, .js, .cpp, .c, .java`;
        dom.terminalOutput.className = 'terminal-output terminal-error';
        return;
    }

    state.isRunning = true;
    dom.runBtn.disabled = true;
    dom.runBtn.classList.add('running');
    dom.terminalOutput.textContent = `⏳ Running ${filename}...`;
    dom.terminalOutput.className = 'terminal-output terminal-running';

    // For compiled languages, collect all related source files
    const compiledExts = ['cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'java'];
    const extraFiles = {};
    if (compiledExts.includes(ext)) {
        for (const [fname, fdata] of Object.entries(state.files)) {
            if (fname === filename) continue;
            const fext = fname.split('.').pop().toLowerCase();
            if (compiledExts.includes(fext)) {
                extraFiles[fname] = fdata.code;
            }
        }
    }

    try {
        const response = await fetch('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language, extra_files: extraFiles }),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || `Server error: ${response.status}`);
        }

        const result = await response.json();
        let output = '';
        if (result.stdout) output += result.stdout;
        if (result.stderr) output += (output ? '\n' : '') + result.stderr;
        if (!output) output = '(no output)';

        dom.terminalOutput.textContent = output;
        dom.terminalOutput.className = result.exit_code === 0
            ? 'terminal-output terminal-success'
            : 'terminal-output terminal-error';
    } catch (err) {
        dom.terminalOutput.textContent = `❌ ${err.message}`;
        dom.terminalOutput.className = 'terminal-output terminal-error';
    } finally {
        state.isRunning = false;
        dom.runBtn.disabled = false;
        dom.runBtn.classList.remove('running');
    }
}

// --- HANDLE AGENT EVENTS ---
function handleAgentEvent(data) {
    const { agent, status, content, plan, task_plan, current_file } = data;

    // Update pipeline
    if (agent !== 'system') {
        activatePipelineStep(agent);
    }

    // Add activity card
    if (content) {
        const agentInfo = AGENTS[agent] || AGENTS.system;
        const title = agentInfo.label;
        addActivityCard(agent, title, content, true);
    }

    // Handle plan data
    if (plan) {
        showPlanDetails(plan);
        updateFilesList(plan.files);
    }

    // Handle architecture steps
    if (task_plan) {
        showArchDetails(task_plan);
    }

    // Handle file creation from coder
    if (agent === 'coder' && content) {
        extractAndStoreCode(content, current_file);
        // Update preview after each coder output
        updateLivePreview();
    }

    // Handle completion
    if (status === 'complete' || status === 'done') {
        updateLivePreview();
    }
}

// --- FULL RESET ---
function resetAll() {
    // Reset pipeline
    resetPipeline();

    // Clear welcome and old cards
    dom.activityFeed.innerHTML = '';

    // Reset state
    state.files = {};
    state.activeCodeFile = null;
    state.projectFiles = { html: '', css: '', js: '' };

    // Reset files panel
    dom.filesList.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">📂</div>
            <p>Files will appear here as agents generate them.</p>
        </div>
    `;
    dom.planDetails.classList.add('hidden');
    dom.archDetails.classList.add('hidden');

    // Reset code editor
    dom.codeFileTabs.innerHTML = '';
    if (state.editor) {
        state.editor.setValue('// Generated code will appear here...');
    }

    // Reset preview
    dom.previewIframe.srcdoc = '';
    dom.previewIframe.classList.remove('visible');
    dom.previewEmpty.classList.remove('hidden');

    // Reset terminal
    dom.terminalOutput.textContent = 'Run code to see output here...';
    dom.terminalOutput.className = 'terminal-output';
}

// --- PIPELINE TRACKER ---
let completedSteps = new Set();

function resetPipeline() {
    completedSteps.clear();
    document.querySelectorAll('.pipeline-step').forEach(s => {
        s.classList.remove('active', 'completed');
        s.querySelector('.step-status').textContent = 'Waiting';
    });
    document.querySelectorAll('.pipeline-connector').forEach(c => {
        c.classList.remove('active');
    });
}

function activatePipelineStep(agent) {
    const order = ['planner', 'architect', 'coder', 'done'];
    const idx = order.indexOf(agent);

    for (let i = 0; i < idx; i++) {
        const step = document.getElementById(`step-${order[i]}`);
        if (step && !completedSteps.has(order[i])) {
            step.classList.remove('active');
            step.classList.add('completed');
            step.querySelector('.step-status').textContent = 'Done ✓';
            completedSteps.add(order[i]);
        }
    }

    const connectors = document.querySelectorAll('.pipeline-connector');
    connectors.forEach((c, i) => {
        if (i < idx) c.classList.add('active');
    });

    const currentStep = document.getElementById(`step-${agent}`);
    if (currentStep) {
        currentStep.classList.remove('completed');
        currentStep.classList.add('active');
        const statusText = agent === 'done' ? 'Complete! ✓' : 'Working...';
        currentStep.querySelector('.step-status').textContent = statusText;

        if (agent === 'done') {
            currentStep.classList.remove('active');
            currentStep.classList.add('completed');
            completedSteps.add(agent);
        }
    }
}

// --- ACTIVITY CARDS ---
function addActivityCard(agent, title, content, expandable) {
    const agentInfo = AGENTS[agent] || AGENTS.system;
    const card = document.createElement('div');
    card.className = `activity-card ${agentInfo.color} expanded`;

    const formattedContent = formatContent(content);

    card.innerHTML = `
        <div class="card-header">
            <div class="card-agent-icon">${agentInfo.icon}</div>
            <div class="card-agent-name">${title}</div>
            <div class="card-status-badge">${agent === 'user' ? 'prompt' : 'output'}</div>
            ${expandable ? '<div class="card-toggle">▼</div>' : ''}
        </div>
        <div class="card-body">
            <div class="card-content">${formattedContent}</div>
        </div>
    `;

    if (expandable) {
        const header = card.querySelector('.card-header');
        header.addEventListener('click', () => {
            card.classList.toggle('expanded');
        });
    }

    dom.activityFeed.appendChild(card);
    dom.activityFeed.scrollTop = dom.activityFeed.scrollHeight;
}

// --- FORMAT CONTENT ---
function formatContent(text) {
    let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- PLAN DETAILS ---
function showPlanDetails(plan) {
    dom.planDetails.classList.remove('hidden');
    let html = `
        <div class="plan-item">
            <div class="plan-item-icon">📦</div>
            <div><strong>${plan.name}</strong> — ${plan.description}</div>
        </div>
        <div class="plan-item">
            <div class="plan-item-icon">🛠️</div>
            <div><strong>Tech Stack:</strong> ${plan.techstack}</div>
        </div>
    `;

    if (plan.features && plan.features.length) {
        html += '<div class="plan-item"><div class="plan-item-icon">⭐</div><div><strong>Features:</strong><br>';
        plan.features.forEach(f => {
            html += `• ${f}<br>`;
        });
        html += '</div></div>';
    }

    dom.planContent.innerHTML = html;
    switchTab('files');
}

// --- ARCHITECTURE DETAILS ---
function showArchDetails(taskPlan) {
    dom.archDetails.classList.remove('hidden');
    let html = '';
    taskPlan.steps.forEach((step, i) => {
        html += `
            <div class="arch-step" id="arch-step-${i}" data-filepath="${step.filepath}">
                <div class="arch-step-num">${i + 1}</div>
                <div>
                    <strong>${step.filepath}</strong><br>
                    <span style="color: var(--text-muted); font-size: 12px;">${step.task}</span>
                </div>
            </div>
        `;
    });
    dom.archContent.innerHTML = html;
}

// --- FILES LIST ---
function updateFilesList(files) {
    dom.filesList.innerHTML = '';
    files.forEach(file => {
        const ext = file.path.split('.').pop().toLowerCase();
        const icon = getFileIcon(ext);
        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.path = file.path;
        item.innerHTML = `
            <div class="file-icon">${icon}</div>
            <div class="file-info">
                <div class="file-name">${file.path}</div>
                <div class="file-purpose">${file.purpose}</div>
            </div>
            <div class="file-status" title="Pending">⏳</div>
        `;
        item.addEventListener('click', () => {
            if (state.files[file.path]) {
                switchTab('code');
                showCodeFile(file.path);
            }
        });
        dom.filesList.appendChild(item);
    });
}

function markFileGenerated(filepath) {
    let item = dom.filesList.querySelector(`[data-path="${filepath}"]`);
    if (!item) {
        const basename = filepath.split('/').pop().split('\\').pop();
        dom.filesList.querySelectorAll('.file-item').forEach(el => {
            const elPath = el.dataset.path;
            const elBase = elPath.split('/').pop().split('\\').pop();
            if (elBase === basename) item = el;
        });
    }
    if (item) {
        const statusEl = item.querySelector('.file-status');
        statusEl.textContent = '✅';
        statusEl.title = 'Generated';
        statusEl.classList.remove('generating');
    }

    const archSteps = dom.archContent.querySelectorAll('.arch-step');
    archSteps.forEach(step => {
        const stepPath = step.dataset.filepath;
        if (stepPath === filepath || stepPath.endsWith(filepath) || filepath.endsWith(stepPath)) {
            step.classList.remove('active');
            step.classList.add('completed');
        }
    });
}

function markFileGenerating(filepath) {
    let item = dom.filesList.querySelector(`[data-path="${filepath}"]`);
    if (!item) {
        const basename = filepath.split('/').pop().split('\\').pop();
        dom.filesList.querySelectorAll('.file-item').forEach(el => {
            const elPath = el.dataset.path;
            const elBase = elPath.split('/').pop().split('\\').pop();
            if (elBase === basename) item = el;
        });
    }
    if (item) {
        const statusEl = item.querySelector('.file-status');
        statusEl.textContent = '⚙️';
        statusEl.title = 'Generating...';
        statusEl.classList.add('generating');
    }
}

function getFileIcon(ext) {
    const icons = {
        html: '🌐', css: '🎨', js: '⚡', py: '🐍', json: '📋',
        md: '📝', txt: '📄', ts: '💠', jsx: '⚛️', tsx: '⚛️',
        vue: '💚', svelte: '🔥', yaml: '⚙️', yml: '⚙️',
        sql: '🗃️', env: '🔒', gitignore: '🙈',
        cpp: '🔷', c: '🔷', h: '📎', hpp: '📎', java: '☕',
    };
    return icons[ext] || '📄';
}

// --- CODE EXTRACTION (ROBUST) ---
function extractAndStoreCode(content, currentFile) {
    if (currentFile) {
        markFileGenerating(currentFile);
    }

    let foundAny = false;

    const headerPatterns = [
        /#{2,4}\s*`([^`\n]+?)`\s*\n\s*```(\w+)?\n([\s\S]*?)```/g,
        /\*\*(?:File:\s*)?([^\*\n]+?\.\w+)\*\*\s*\n\s*```(\w+)?\n([\s\S]*?)```/g,
        /`([^`\n]+?\.\w+)`[:\s]*\n\s*```(\w+)?\n([\s\S]*?)```/g,
        /#{2,4}\s+([\w\/\\.-]+\.\w+)\s*\n\s*```(\w+)?\n([\s\S]*?)```/g,
    ];

    for (const pattern of headerPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const filename = match[1].trim();
            const language = match[2] || guessLanguage(filename);
            const code = match[3].trim();

            if (code.length > 5) {
                storeFile(filename, code, language);
                foundAny = true;
            }
        }
    }

    if (!foundAny && currentFile) {
        const simpleRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;
        while ((match = simpleRegex.exec(content)) !== null) {
            const lang = match[1] || guessLanguage(currentFile);
            const code = match[2].trim();
            if (code.length > 5) {
                storeFile(currentFile, code, lang);
                foundAny = true;
                break;
            }
        }
    }

    if (!foundAny) {
        const allBlocksRegex = /```(\w+)\n([\s\S]*?)```/g;
        let match;
        while ((match = allBlocksRegex.exec(content)) !== null) {
            const lang = match[1];
            const code = match[2].trim();

            if (code.length > 5) {
                const filename = guessFilename(lang, Object.keys(state.files).length);
                storeFile(filename, code, lang);
                foundAny = true;
            }
        }
    }

    if (currentFile) {
        markFileGenerated(currentFile);
    }

    if (foundAny && !state.activeCodeFile && Object.keys(state.files).length > 0) {
        const firstFile = Object.keys(state.files)[0];
        showCodeFile(firstFile);
        switchTab('code');
    }
}

function storeFile(filename, code, language) {
    state.files[filename] = { code, language };
    addCodeFileTab(filename);
    markFileGenerated(filename);

    const ext = filename.split('.').pop().toLowerCase();

    if (ext === 'html' || ext === 'htm') {
        state.projectFiles.html = code;
    } else if (ext === 'css') {
        state.projectFiles.css = code;
    } else if (ext === 'js' || ext === 'javascript' || ext === 'mjs') {
        state.projectFiles.js = code;
    }

    if (state.activeCodeFile === filename) {
        showCodeFile(filename);
    }
}

function guessLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        html: 'html', htm: 'html', css: 'css', js: 'javascript',
        mjs: 'javascript', ts: 'typescript', py: 'python',
        json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml',
        sql: 'sql', sh: 'bash', bat: 'batch',
        cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c',
        h: 'cpp', hpp: 'cpp', java: 'java',
    };
    return map[ext] || 'markup';
}

function guessFilename(language, idx) {
    const map = {
        html: 'index.html', css: 'styles.css', javascript: 'app.js',
        js: 'app.js', python: 'main.py', json: 'config.json',
        markdown: 'README.md', md: 'README.md',
        cpp: 'main.cpp', c: 'main.c', java: 'Main.java',
    };
    return map[language] || `file_${idx}.${language}`;
}

// --- CODE EDITOR ---
function addCodeFileTab(filename) {
    if (dom.codeFileTabs.querySelector(`[data-file="${filename}"]`)) return;

    const tab = document.createElement('button');
    tab.className = 'code-file-tab';
    tab.dataset.file = filename;
    const displayName = filename.split('/').pop().split('\\').pop();
    tab.textContent = displayName;
    tab.title = filename;
    tab.addEventListener('click', () => showCodeFile(filename));
    dom.codeFileTabs.appendChild(tab);
}

function showCodeFile(filename) {
    state.activeCodeFile = filename;
    const fileData = state.files[filename];
    if (!fileData) return;

    dom.codeFileTabs.querySelectorAll('.code-file-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.file === filename);
    });

    // Set CodeMirror mode and content
    const mode = getCodemirrorMode(fileData.language);
    state.editor.setOption('mode', mode);
    state.editor.setValue(fileData.code);
    state.editor.refresh();
}

// --- LIVE PREVIEW ---
function updateLivePreview() {
    const { html, css, js } = state.projectFiles;

    if (!html) return;

    let finalHtml;

    const isFullDocument = /<!DOCTYPE|<html/i.test(html);

    if (isFullDocument) {
        finalHtml = html;

        finalHtml = finalHtml.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["'](?!https?:\/\/)[^"']*["'][^>]*\/?>/gi, '');
        finalHtml = finalHtml.replace(/<link[^>]*href=["'](?!https?:\/\/)[^"']*["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi, '');
        finalHtml = finalHtml.replace(/<script[^>]*src=["'](?!https?:\/\/)[^"']*["'][^>]*><\/script>/gi, '');

        if (css) {
            const styleTag = `<style>${css}</style>`;
            if (finalHtml.includes('</head>')) {
                finalHtml = finalHtml.replace('</head>', `${styleTag}\n</head>`);
            } else {
                finalHtml = styleTag + '\n' + finalHtml;
            }
        }

        if (js) {
            const scriptTag = `<script>${js}<\/script>`;
            if (finalHtml.includes('</body>')) {
                finalHtml = finalHtml.replace('</body>', `${scriptTag}\n</body>`);
            } else {
                finalHtml = finalHtml + '\n' + scriptTag;
            }
        }
    } else {
        finalHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${css}</style></head>
<body>${html}<script>${js}<\/script></body>
</html>`;
    }

    dom.previewIframe.srcdoc = finalHtml;
    dom.previewIframe.classList.add('visible');
    dom.previewEmpty.classList.add('hidden');
}

// --- STATUS INDICATOR ---
function setStatus(type, text) {
    dom.statusIndicator.className = `status-${type}`;
    dom.statusText.textContent = text;
}
