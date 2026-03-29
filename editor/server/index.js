// ==========================================
// 1. IMPORTS & DEPENDENCIES
// ==========================================
const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const pty = require('node-pty');
const os = require('os');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const cors = require('cors');
const chokidar = require('chokidar');

// ==========================================
// 2. TERMINAL SETUP
// ==========================================
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

const userDir = process.env.USER_DIR || path.resolve(__dirname, 'user');
if (!fsSync.existsSync(userDir)) {
    fsSync.mkdirSync(userDir, { recursive: true });
}

const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 10,
    cwd: userDir,
    env: process.env
});

// ==========================================
// 3. SERVER INITIALIZATION
// ==========================================
const app = express();
const server = http.createServer(app);

const io = new SocketServer(server, {
    cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// ==========================================
// 4. FILE WATCHING
// ==========================================
chokidar.watch(userDir, {
    ignoreInitial: true,
    depth: 10,
    usePolling: true,
    interval: 500,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
}).on('all', (event, filePath) => {
    io.emit('file:refresh', filePath);
});

// ==========================================
// 5. FILE API ROUTES
// ==========================================
app.get('/files', async (req, res) => {
    try {
        const fileTree = await generateFileTree(userDir);
        return res.json({ tree: fileTree });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to read file tree' });
    }
});

app.get('/files/content', async (req, res) => {
    try {
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ error: 'No path provided' });
        const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(userDir, safePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return res.json({ content });
    } catch (err) {
        return res.status(404).json({ error: 'File not found' });
    }
});

// ── WRITE FILE CONTENT (used by Yjs persistence) ──
app.post('/files/content-write', async (req, res) => {
    try {
        const { path: filePath, content } = req.body;
        if (!filePath) return res.status(400).json({ error: 'No path provided' });
        const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(userDir, safePath);
        const dir = path.dirname(fullPath);
        if (!fsSync.existsSync(dir)) await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── CREATE FILE ──
app.post('/files/create', async (req, res) => {
    try {
        const { filePath, isDirectory } = req.body;
        if (!filePath) return res.status(400).json({ error: 'No path provided' });

        const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(userDir, safePath);

        if (isDirectory) {
            await fs.mkdir(fullPath, { recursive: true });
        } else {
            // Ensure parent directory exists
            const dir = path.dirname(fullPath);
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            // Create empty file
            await fs.writeFile(fullPath, '', 'utf-8');
        }
        return res.json({ success: true, path: safePath });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── DELETE FILE/FOLDER ──
app.post('/files/delete', async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath) return res.status(400).json({ error: 'No path provided' });

        const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(userDir, safePath);

        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force: true });
        } else {
            await fs.unlink(fullPath);
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 6. CODE EXTRACTION HELPERS
// ==========================================

/**
 * Generate a short project folder name from the user's prompt.
 * "build a calculator app" → "calculator-app"
 * "create an e-commerce website with React" → "ecommerce-website"
 */
function generateProjectName(prompt) {
    const stopWords = new Set([
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
        'build', 'create', 'make', 'develop', 'write', 'code', 'generate',
        'implement', 'design', 'construct', 'setup', 'set', 'up',
        'for', 'of', 'in', 'to', 'and', 'or', 'but', 'with', 'using',
        'that', 'this', 'it', 'its', 'my', 'me', 'i', 'we', 'our',
        'please', 'want', 'like', 'need', 'use', 'simple', 'basic',
    ]);

    const words = prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 1 && !stopWords.has(w))
        .slice(0, 3); // Take max 3 meaningful words

    if (words.length === 0) {
        return 'project-' + Date.now().toString(36);
    }

    return words.join('-');
}

function extractFilesFromCoderOutput(content) {
    const files = [];

    // Strategy 1: Header + code block pattern (FLEXIBLE — allows text between header and code block)
    // Matches: ### `filename.ext` ... (any text/newlines) ... ```lang\ncode```
    const headerCodePattern = /(?:#{1,4}\s*`([^`]+)`|#{1,4}\s*\*\*([^*]+)\*\*|#{1,4}\s+([\w.\/-]+\.\w{1,10}))\s*\n[\s\S]*?```\w*\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = headerCodePattern.exec(content)) !== null) {
        const filePath = (match[1] || match[2] || match[3]).trim();
        const code = match[4];
        if (filePath && code && code.trim().length > 5) {
            console.log(`[AI] 📄 Strategy 1 extracted: ${filePath} (${code.length} chars)`);
            files.push({ filePath: cleanFilePath(filePath), code: code.trimEnd() });
        }
    }

    // Strategy 1b: Backtick filename on its own line before a code block (e.g. `app.js`:\n```js)
    if (files.length === 0) {
        console.log('[AI] ⚠️ Strategy 1 found 0 files, trying Strategy 1b...');
        const backtickPattern = /`([\w.\/-]+\.\w{1,10})`[:\s]*\n[\s\S]*?```\w*\s*\n([\s\S]*?)```/g;
        let m;
        while ((m = backtickPattern.exec(content)) !== null) {
            const filePath = m[1].trim();
            const code = m[2];
            if (filePath && code && code.trim().length > 5) {
                console.log(`[AI] 📄 Strategy 1b extracted: ${filePath} (${code.length} chars)`);
                files.push({ filePath: cleanFilePath(filePath), code: code.trimEnd() });
            }
        }
    }

    // Strategy 2: Comment-based file paths inside code blocks
    if (files.length === 0) {
        console.log('[AI] ⚠️ Strategy 1b found 0 files, trying Strategy 2...');
        const codeBlockPattern = /```(\w+)?\s*\n([\s\S]*?)```/g;
        let codeMatch;
        while ((codeMatch = codeBlockPattern.exec(content)) !== null) {
            const code = codeMatch[2];
            const firstLines = code.split('\n').slice(0, 5).join('\n');
            const commentPathPatterns = [
                /(?:\/\/|#|--|\/\*|<!--)\s*(?:File|Filename|Path):\s*([\w.\/-]+\.\w{1,10})/i,
                /(?:\/\/|#|--|\/\*|<!--)\s*([\w.\/-]+\.\w{1,10})\s*(?:\*\/|-->)?\s*$/m,
            ];
            let filePath = null;
            for (const pattern of commentPathPatterns) {
                const m = firstLines.match(pattern);
                if (m) { filePath = m[1]; break; }
            }
            if (filePath) {
                console.log(`[AI] 📄 Strategy 2 extracted: ${filePath}`);
                files.push({ filePath: cleanFilePath(filePath), code: code.trimEnd() });
            }
        }
    }

    if (files.length === 0) {
        // Log first 300 chars for debugging what the content looks like
        console.log(`[AI] ❌ No files extracted from regex. Content preview (300 chars): ${content.substring(0, 300)}`);
    }

    return files;
}

function cleanFilePath(fp) {
    return fp.replace(/^[\/\\]+/, '').replace(/\\/g, '/').trim();
}

async function writeCodeFile(projectFolder, filePath, code) {
    const cleanPath = cleanFilePath(filePath);
    const fullPath = path.join(userDir, projectFolder, cleanPath);
    const dir = path.dirname(fullPath);

    if (!fsSync.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(fullPath, code, 'utf-8');
    const relativePath = `${projectFolder}/${cleanPath}`;
    console.log(`[AI] ✅ Wrote file: ${relativePath} (${code.length} bytes)`);
    return relativePath;
}

// ==========================================
// 7. SOCKET.IO CONNECTION HANDLING
// ==========================================
ptyProcess.onData(data => {
    io.emit('terminal:data', data);
});

io.on('connection', (socket) => {
    console.log(`Socket connected`, socket.id);

    socket.on('file:change', async ({ path: filePath, content }) => {
        try {
            const safePath = filePath.replace(/^\/+/, '');
            const fullPath = path.join(userDir, safePath);
            const dir = path.dirname(fullPath);
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            await fs.writeFile(fullPath, content);
        } catch (err) {
            console.error('Error saving file:', err.message);
        }
    });

    socket.on('terminal:write', (data) => {
        ptyProcess.write(data);
    });

    socket.on('terminal:resize', ({ cols, rows }) => {
        try { ptyProcess.resize(cols, rows); } catch (e) { }
    });

    // ==========================================
    // 8. AI PIPELINE PROXY
    // ==========================================
    socket.on('ai:prompt', async (prompt) => {
        console.log(`[AI] Received prompt: "${prompt.substring(0, 80)}..."`);

        // Generate a project folder name from the prompt
        const projectFolder = generateProjectName(prompt);
        const projectDir = path.join(userDir, projectFolder);

        // Create the project folder
        if (!fsSync.existsSync(projectDir)) {
            await fs.mkdir(projectDir, { recursive: true });
            console.log(`[AI] 📁 Created project folder: ${projectFolder}`);
        }

        // Notify client about the project folder
        socket.emit('ai:project-created', { folder: projectFolder });

        // Track which files have already been written to avoid duplicates
        const writtenFiles = new Set();

        try {
            const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';
            const response = await fetch(`${FASTAPI_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            if (!response.ok) {
                socket.emit('ai:response', {
                    agent: 'system', status: 'error',
                    content: `FastAPI returned ${response.status}: ${response.statusText}`
                });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const eventData = JSON.parse(line.slice(6));
                            console.log(`[AI] SSE event: agent=${eventData.agent}, status=${eventData.status}, has_content=${!!eventData.content}, content_len=${(eventData.content||'').length}, current_file=${eventData.current_file || 'none'}, has_generated_files=${!!eventData.generated_files}`);
                            socket.emit('ai:response', eventData);

                            // PRIMARY METHOD: Use the generated_files dict from Python coder_state
                            // This is the most reliable because the Python coder already parsed the code blocks
                            if (eventData.agent === 'coder' && eventData.generated_files) {
                                console.log(`[AI] 📦 Received generated_files dict with ${Object.keys(eventData.generated_files).length} file(s)`);
                                for (const [filePath, code] of Object.entries(eventData.generated_files)) {
                                    const cleanPath = cleanFilePath(filePath);
                                    if (!writtenFiles.has(cleanPath)) {
                                        try {
                                            const writtenPath = await writeCodeFile(projectFolder, cleanPath, code);
                                            writtenFiles.add(cleanPath);
                                            socket.emit('ai:file-created', { path: '/' + writtenPath });
                                            console.log(`[AI] ✅ Wrote from generated_files: ${cleanPath}`);
                                        } catch (writeErr) {
                                            console.error(`[AI] ❌ Failed to write ${cleanPath}:`, writeErr.message);
                                        }
                                    }
                                }
                            }
                            // FALLBACK METHOD: Extract from coder markdown output via regex
                            else if (eventData.agent === 'coder' && eventData.content) {
                                console.log(`[AI] 🔍 Coder event received (${eventData.content.length} chars), current_file: ${eventData.current_file || 'none'}`);
                                const currentFileFromPlan = eventData.current_file || null;
                                let extractedFiles = extractFilesFromCoderOutput(eventData.content);

                                // Last-resort fallback: use task plan filepath + any code block
                                if (extractedFiles.length === 0 && currentFileFromPlan) {
                                    console.log(`[AI] 🔄 Fallback: using plan filepath "${currentFileFromPlan}"`);
                                    const codeBlockMatch = eventData.content.match(/```\w*\s*\n([\s\S]*?)```/);
                                    if (codeBlockMatch && codeBlockMatch[1].trim().length > 5) {
                                        extractedFiles = [{
                                            filePath: cleanFilePath(currentFileFromPlan),
                                            code: codeBlockMatch[1].trimEnd()
                                        }];
                                        console.log(`[AI] ✅ Fallback extracted ${currentFileFromPlan} (${codeBlockMatch[1].length} chars)`);
                                    } else {
                                        console.log(`[AI] ❌ Fallback failed: no usable code block found in content`);
                                    }
                                }

                                console.log(`[AI] 📊 Total files to write from regex: ${extractedFiles.length}`);
                                for (const file of extractedFiles) {
                                    if (!writtenFiles.has(file.filePath)) {
                                        try {
                                            const writtenPath = await writeCodeFile(projectFolder, file.filePath, file.code);
                                            writtenFiles.add(file.filePath);
                                            socket.emit('ai:file-created', { path: '/' + writtenPath });
                                        } catch (writeErr) {
                                            console.error(`[AI] Failed to write ${file.filePath}:`, writeErr.message);
                                        }
                                    } else {
                                        console.log(`[AI] ⏩ Skipping ${file.filePath} (already written via generated_files)`);
                                    }
                                }
                            }

                            if (eventData.status === 'complete') {
                                console.log(`[AI] Pipeline complete → ${writtenFiles.size} files written to /${projectFolder}/`);
                            }
                        } catch (parseErr) {
                            console.error('[AI] SSE parse error:', parseErr.message);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[AI] Proxy error:', err.message);
            socket.emit('ai:response', {
                agent: 'system', status: 'error',
                content: `Connection error: ${err.message}. Make sure FastAPI is running on port 8000.`
            });
        }
    });
});

// ==========================================
// 9. START UP
// ==========================================
server.listen(9000, () => {
    console.log("Editor server is running on port 9000");
    console.log("Expecting FastAPI AI pipeline on port 8000");
    console.log(`Terminal shell: ${shell}`);
    console.log(`User directory: ${userDir}`);
});

// ==========================================
// 10. HELPER
// ==========================================
async function generateFileTree(directory) {
    const tree = {};
    async function buildTree(currentDir, currentTree) {
        const files = await fs.readdir(currentDir);
        for (const file of files) {
            if (file === 'node_modules' || file === '.git' || file === '__pycache__' || file === '.venv') continue;
            const filePath = path.join(currentDir, file);
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                currentTree[file] = {};
                await buildTree(filePath, currentTree[file]);
            } else {
                currentTree[file] = null;
            }
        }
    }
    await buildTree(directory, tree);
    return tree;
}