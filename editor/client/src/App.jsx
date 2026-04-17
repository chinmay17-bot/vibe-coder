import Terminal from "./components/terminal"
import Chatbot from "./components/Chatbot"
import SessionPicker from "./components/SessionPicker"
import './App.css'
import { useEffect, useState, useCallback, useRef } from "react"
import FileTree, { ContextMenu, InlineInput } from "./components/tree"
import socket from "./socket"
import ReactAce from "react-ace";
import { useCollabCursors } from "./hooks/useCollabCursors"
import { useYjsDoc } from "./hooks/useYjsDoc"

import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-css";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/mode-xml";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-sh";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/theme-one_dark";
import "ace-builds/src-noconflict/ext-language_tools";

const AceEditor = ReactAce.default || ReactAce;

import ace from "ace-builds";
ace.config.set("basePath", "https://cdn.jsdelivr.net/npm/ace-builds@1.32.2/src-noconflict/");

const EXT_TO_MODE = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', less: 'css',
  json: 'json',
  java: 'java',
  c: 'c_cpp', cpp: 'c_cpp', h: 'c_cpp', hpp: 'c_cpp',
  md: 'markdown', mdx: 'markdown',
  xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  txt: 'text', log: 'text', env: 'text',
};

const EXT_TO_ICON = {
  js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
  py: '🐍', html: '🌐', css: '🎨', json: '📋',
  java: '☕', c: '🔧', cpp: '🔧', h: '🔧',
  md: '📝', yaml: '⚙️', yml: '⚙️', sh: '💲',
  txt: '📄', default: '📄',
};

function getEditorMode(filePath) {
  if (!filePath) return 'text';
  const ext = filePath.split('.').pop().toLowerCase();
  return EXT_TO_MODE[ext] || 'text';
}

function getFileIcon(fileName) {
  if (!fileName) return '📄';
  const ext = fileName.split('.').pop().toLowerCase();
  return EXT_TO_ICON[ext] || EXT_TO_ICON.default;
}

function getFileName(filePath) {
  if (!filePath) return '';
  return filePath.split('/').pop();
}

// Helper: all REST calls go to orchestrator with session header
import { ORCHESTRATOR_URL } from './config';
const API = ORCHESTRATOR_URL;
const apiFetch = (path, opts = {}) => {
  const sid = sessionStorage.getItem('sessionId');
  return fetch(`${API}${path}`, {
    ...opts,
    headers: { 'x-session-id': sid, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
};

function App() {
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionId, setSessionId] = useState(sessionStorage.getItem('sessionId'))
  const [fileTree, setFileTree] = useState({})
  const [selectedFile, setSelectedFile] = useState('')
  const [selectedFileContent, setSelectedFileContent] = useState('')
  const [code, setCode] = useState('')
  const [openTabs, setOpenTabs] = useState([])
  const [terminalVisible, setTerminalVisible] = useState(true)
  const [chatVisible, setChatVisible] = useState(true)
  const [ctxMenu, setCtxMenu] = useState(null)
  const [inlineInput, setInlineInput] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runOutput, setRunOutput] = useState('')
  const [showRunOutput, setShowRunOutput] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [renameInput, setRenameInput] = useState(null)
  const isSaved = true

  const deleteRef = useRef(null)
  const aceRef = useRef(null)
  const fileSelectRef = useRef(null)

  const { ytext, synced } = useYjsDoc(sessionId, selectedFile, selectedFileContent)
  const { remoteCursors } = useCollabCursors(aceRef, selectedFile)

  // Bind Yjs text to the Ace editor
  useEffect(() => {
    if (!aceRef.current || !ytext || !synced) return
    const editor = aceRef.current
    const aceSession = editor.getSession()
    const doc = aceSession.getDocument()
    let isApplyingRemote = false

    // Set initial content
    const initial = ytext.toString()
    if (aceSession.getValue() !== initial) {
      isApplyingRemote = true
      aceSession.setValue(initial)
      isApplyingRemote = false
    }

    // Yjs → Ace: apply remote changes using positional deltas
    const onYjsUpdate = (event) => {
      if (isApplyingRemote) return
      isApplyingRemote = true
      try {
        // Save cursor position as a text index before applying changes
        const cursorIndex = doc.positionToIndex(editor.getCursorPosition(), 0)
        let adjustedIndex = cursorIndex

        // Calculate how much the cursor needs to shift based on remote changes
        let remoteOffset = 0
        event.changes.forEach(change => {
          if (change.retain) {
            remoteOffset += change.retain
          } else if (change.insert) {
            // If insertion is before cursor, shift cursor right
            if (remoteOffset <= cursorIndex) {
              adjustedIndex += change.insert.length
            }
            remoteOffset += change.insert.length
          } else if (change.delete) {
            // If deletion is before cursor, shift cursor left
            if (remoteOffset < cursorIndex) {
              const deleteEnd = remoteOffset + change.delete
              if (deleteEnd <= cursorIndex) {
                adjustedIndex -= change.delete
              } else {
                adjustedIndex -= cursorIndex - remoteOffset
              }
            }
          }
        })

        // Apply the changes to Ace
        let index = 0
        event.changes.forEach(change => {
          if (change.retain) {
            index += change.retain
          } else if (change.insert) {
            const pos = doc.indexToPosition(index, 0)
            aceSession.insert(pos, change.insert)
            index += change.insert.length
          } else if (change.delete) {
            const start = doc.indexToPosition(index, 0)
            const end = doc.indexToPosition(index + change.delete, 0)
            aceSession.remove({ start, end })
          }
        })

        // Restore cursor at adjusted position
        const newPos = doc.indexToPosition(Math.max(0, adjustedIndex), 0)
        editor.moveCursorToPosition(newPos)
      } catch {
        // Fallback for edge cases
        const pos = editor.getCursorPosition()
        aceSession.setValue(ytext.toString())
        editor.moveCursorToPosition(pos)
      }
      isApplyingRemote = false
    }
    ytext.observe(onYjsUpdate)

    // Ace → Yjs: convert Ace delta to Yjs positional ops
    const onAceChange = (delta) => {
      if (isApplyingRemote) return
      isApplyingRemote = true
      try {
        const start = doc.positionToIndex(delta.start, 0)
        if (delta.action === 'insert') {
          ytext.insert(start, delta.lines.join('\n'))
        } else if (delta.action === 'remove') {
          const length = delta.lines.join('\n').length
          ytext.delete(start, length)
        }
      } catch (e) {
        console.warn('[Yjs] delta error:', e.message)
      }
      isApplyingRemote = false
    }
    aceSession.on('change', onAceChange)

    return () => {
      ytext.unobserve(onYjsUpdate)
      aceSession.off('change', onAceChange)
    }
  }, [ytext, synced])

  // Session status listener
  useEffect(() => {
    socket.on('session:status', ({ status }) => {
      if (status === 'ready') {
        setSessionReady(true)
        setTimeout(getFileTree, 500)
      }
    })
    return () => socket.off('session:status')
  }, [])

  const getFileTree = async () => {
    try {
      const response = await apiFetch('/files')
      const result = await response.json()
      setFileTree(result.tree)
    } catch (err) {
      console.error('Failed to fetch file tree:', err)
    }
  }

  // ── File management handlers (defined early so refs can capture them) ──
  const handleDeleteItem = async (filePath) => {
    try {
      const res = await apiFetch('/files/delete', {
        method: 'POST',
        body: JSON.stringify({ filePath })
      })
      const data = await res.json()
      if (data.success) {
        console.log('Deleted:', filePath)
        setOpenTabs(prev => prev.filter(t => t !== filePath))
        if (selectedFile === filePath) {
          setSelectedFile('')
          setCode('')
          setSelectedFileContent('')
        }
      } else {
        console.error('Delete failed:', data.error)
      }
      getFileTree()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  deleteRef.current = handleDeleteItem

  // ── Rename handler ──
  const handleRenameItem = async (oldPath, newName) => {
    if (!newName) return
    const parts = oldPath.split('/')
    parts[parts.length - 1] = newName
    const newPath = parts.join('/')
    try {
      const res = await apiFetch('/files/rename', {
        method: 'POST',
        body: JSON.stringify({ oldPath, newPath })
      })
      const data = await res.json()
      if (data.success) {
        setOpenTabs(prev => prev.map(t => t === oldPath ? newPath : t))
        if (selectedFile === oldPath) {
          setSelectedFile(newPath)
        }
      } else {
        console.error('Rename failed:', data.error)
      }
      getFileTree()
    } catch (err) {
      console.error('Failed to rename:', err)
    }
  }
  const renameRef = useRef(null)
  renameRef.current = handleRenameItem

  const getFileContents = useCallback(async () => {
    if (!selectedFile) return
    try {
      const response = await apiFetch(`/files/content?path=${selectedFile}`)
      if (response.status === 404) {
        // File was deleted — close the tab
        setOpenTabs(prev => prev.filter(t => t !== selectedFile))
        setSelectedFile('')
        setCode('')
        setSelectedFileContent('')
        return
      }
      const result = await response.json()
      setSelectedFileContent(result.content)
    } catch (err) {
      console.error('Failed to fetch file content:', err)
    }
  }, [selectedFile])

  // Load file content into editor
  useEffect(() => {
    if (selectedFile && selectedFileContent !== undefined) {
      setCode(selectedFileContent)
    }
  }, [selectedFileContent])

  // Fetch content when file is selected
  useEffect(() => {
    if (selectedFile) {
      getFileContents()
    }
  }, [selectedFile, getFileContents])

  // Auto-refresh file tree on changes
  useEffect(() => {
    if (!sessionReady) return
    socket.on('file:refresh', getFileTree)
    return () => { socket.off('file:refresh', getFileTree) }
  }, [sessionReady])

  const handleFileSelect = (path) => {
    setSelectedFile(path)
    if (!openTabs.includes(path)) {
      setOpenTabs(prev => [...prev, path])
    }
  }

  const handleTabClose = (e, path) => {
    e.stopPropagation()
    const newTabs = openTabs.filter(t => t !== path)
    setOpenTabs(newTabs)
    if (selectedFile === path) {
      if (newTabs.length > 0) {
        setSelectedFile(newTabs[newTabs.length - 1])
      } else {
        setSelectedFile('')
        setCode('')
        setSelectedFileContent('')
      }
    }
  }

  // Keep the ref always pointing to latest handleFileSelect
  fileSelectRef.current = handleFileSelect

  // Auto-open generated files in editor AND refresh content if already open
  useEffect(() => {
    const handleFileCreated = async (data) => {
      if (data.path) {
        const filePath = data.path.startsWith('/') ? data.path.slice(1) : data.path
        const fullPath = '/' + filePath

        // Always refresh the file tree
        getFileTree()

        // If this file is already open in the editor, force-refresh its content
        if (selectedFile === fullPath) {
          try {
            const response = await apiFetch(`/files/content?path=${fullPath}`)
            const result = await response.json()
            setSelectedFileContent(result.content)
            setCode(result.content)
            console.log(`[App] ✅ Refreshed editor content for: ${fullPath}`)
          } catch (err) {
            console.error('[App] Failed to refresh file content:', err)
          }
        } else {
          // Open the file in a new tab
          fileSelectRef.current(fullPath)
        }
      }
    }
    socket.on('ai:file-created', handleFileCreated)
    return () => socket.off('ai:file-created', handleFileCreated)
  }, [selectedFile])

  // Listen for context menu events from file tree nodes
  useEffect(() => {
    const handleCtxEvent = (e) => {
      const { x, y, path, isDir, fileName } = e.detail
      const items = []
      if (isDir) {
        items.push({ icon: '📄', label: 'New File', action: () => setInlineInput({ parentPath: path, type: 'file' }) })
        items.push({ icon: '📁', label: 'New Folder', action: () => setInlineInput({ parentPath: path, type: 'folder' }) })
        items.push({ divider: true })
      }
      items.push({ icon: '✏️', label: 'Rename', action: () => setRenameInput({ path, fileName }) })
      items.push({ icon: '🗑️', label: 'Delete', action: () => deleteRef.current(path) })
      setCtxMenu({ x, y, items })
    }
    window.addEventListener('tree-context-menu', handleCtxEvent)
    return () => window.removeEventListener('tree-context-menu', handleCtxEvent)
  }, [])



  // Save file to server
  const handleSaveNow = async () => {
    if (!selectedFile || !aceRef.current) return
    const content = aceRef.current.getSession().getValue()
    try {
      await apiFetch('/files/content-write', {
        method: 'POST',
        body: JSON.stringify({ path: selectedFile.replace(/^\//, ''), content })
      })
    } catch (err) {
      console.error('Failed to save:', err)
    }
  }

  // Handle editor changes — save via socket when typing
  const handleEditorChange = (newValue) => {
    setCode(newValue)
    // Auto-save via file:change socket event
    if (selectedFile) {
      socket.emit('file:change', { path: selectedFile, content: newValue })
    }
  }

  // Run code via /api/execute
  const handleRunCode = async () => {
    if (!selectedFile || isRunning) return
    const ext = selectedFile.split('.').pop().toLowerCase()
    const langMap = {
      py: 'python', js: 'javascript', mjs: 'javascript',
      cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', java: 'java',
    }
    const language = langMap[ext]
    if (!language) {
      setRunOutput(`⚠️ Cannot run .${ext} files. Supported: .py, .js, .cpp, .c, .java`)
      setTerminalVisible(true)
      return
    }
    setIsRunning(true)
    setShowRunOutput(true)
    setRunOutput(`⏳ Running ${getFileName(selectedFile)}...`)
    try {
      const currentCode = aceRef.current ? aceRef.current.getSession().getValue() : code
      const res = await fetch('http://localhost:8000/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: currentCode, language })
      })
      const result = await res.json()
      let output = ''
      if (result.stdout) output += result.stdout
      if (result.stderr) output += (output ? '\n' : '') + result.stderr
      if (!output) output = '(no output)'
      setRunOutput(output)
    } catch (err) {
      setRunOutput(`❌ Error: ${err.message}`)
    } finally {
      setIsRunning(false)
    }
  }

  // ── File management handlers ──
  const handleCreateItem = async (name) => {
    if (!inlineInput || !name) { setInlineInput(null); return }
    const filePath = inlineInput.parentPath + '/' + name
    try {
      await apiFetch('/files/create', {
        method: 'POST',
        body: JSON.stringify({ filePath, isDirectory: inlineInput.type === 'folder' })
      })
      getFileTree()
    } catch (err) {
      console.error('Failed to create:', err)
    }
    setInlineInput(null)
  }

  // Show session picker if not ready
  if (!sessionReady) {
    return (
      <SessionPicker onSessionReady={(sid) => {
        setSessionId(sid)
        setSessionReady(true)
        setTimeout(getFileTree, 500)
      }} />
    )
  }

  return (
    <div className="ide-root">
      {/* ─── ACTIVITY BAR (far-left icon strip) ─── */}
      <div className="activity-bar">
        <div className="ab-top">
          <button className="ab-icon active" title="Explorer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          </button>
        </div>
        <div className="ab-bottom">
          <button className={`ab-icon ${previewVisible ? 'active' : ''}`} title="Live Preview" onClick={() => setPreviewVisible(v => !v)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </button>
          <button className={`ab-icon ${terminalVisible ? 'active' : ''}`} title="Terminal" onClick={() => setTerminalVisible(v => !v)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          </button>
          <button className={`ab-icon ${chatVisible ? 'active' : ''}`} title="AI Assistant" onClick={() => setChatVisible(v => !v)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          </button>
        </div>
      </div>

      {/* ─── SIDEBAR (file tree) ─── */}
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">EXPLORER</span>
        </div>
        <div className="sidebar-tree">
          <FileTree onSelect={handleFileSelect} tree={fileTree} />
          {inlineInput && (
            <div style={{ padding: '4px 12px' }}>
              <InlineInput
                placeholder={inlineInput.type === 'file' ? 'filename.ext' : 'folder-name'}
                onSubmit={handleCreateItem}
                onCancel={() => setInlineInput(null)}
              />
            </div>
          )}
          {renameInput && (
            <div style={{ padding: '4px 12px' }}>
              <InlineInput
                placeholder={renameInput.fileName}
                onSubmit={(newName) => {
                  renameRef.current(renameInput.path, newName)
                  setRenameInput(null)
                }}
                onCancel={() => setRenameInput(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* ─── MAIN AREA ─── */}
      <div className="main-area">
        {/* Tab bar */}
        <div className="tab-bar">
          {openTabs.length === 0 && (
            <div className="tab-empty">No open editors</div>
          )}
          {openTabs.map(tab => (
            <div
              key={tab}
              className={`tab ${tab === selectedFile ? 'tab-active' : ''}`}
              onClick={() => setSelectedFile(tab)}
            >
              <span className="tab-icon">{getFileIcon(getFileName(tab))}</span>
              <span className="tab-name">{getFileName(tab)}</span>
              <span className={`tab-dot ${selectedFile === tab && !isSaved ? 'unsaved' : ''}`}></span>
              <button className="tab-close" onClick={(e) => handleTabClose(e, tab)}>×</button>
            </div>
          ))}
          {selectedFile && (
            <div className="tab-bar-right">
              {/* Active users on this file */}
              {[...remoteCursors.entries()]
                .filter(([, c]) => c.file === selectedFile)
                .map(([socketId, cursor]) => (
                  <span key={socketId} style={{
                    background: cursor.color,
                    color: '#fff',
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    marginRight: '6px',
                    fontFamily: 'monospace',
                  }}>
                    👤 {socketId.slice(0, 4)}
                  </span>
                ))
              }
              <span className={`save-status ${isSaved ? 'saved' : 'unsaved'}`}>
                {isSaved ? '✓ Saved' : '● Modified'}
              </span>
              {!isSaved && <button className="save-btn" onClick={handleSaveNow}>Save</button>}
              {['py','js','c','cpp','java'].includes(selectedFile.split('.').pop().toLowerCase()) && (
                <button className="run-btn" onClick={handleRunCode} disabled={isRunning} title="Run this file">
                  {isRunning ? '⏳' : '▶'} Run
                </button>
              )}
            </div>
          )}
        </div>

        {/* Editor + Chat split */}
        <div className="editor-chat-split">
          {/* Code editor */}
          <div className="editor-pane">
            {selectedFile ? (
              <>
                <div className="breadcrumb">
                  {selectedFile.split('/').filter(Boolean).map((part, i, arr) => (
                    <span key={i}>
                      <span className="breadcrumb-item">{part}</span>
                      {i < arr.length - 1 && <span className="breadcrumb-sep">›</span>}
                    </span>
                  ))}
                </div>
                <div className="ace-wrapper">
                  <AceEditor
                    mode={getEditorMode(selectedFile)}
                    theme="one_dark"
                    width="100%"
                    height="100%"
                    fontSize={14}
                    showPrintMargin={false}
                    showGutter={true}
                    highlightActiveLine={true}
                    value={code}
                    onChange={handleEditorChange}
                    onLoad={(editor) => { aceRef.current = editor; }}
                    setOptions={{
                      enableBasicAutocompletion: true,
                      enableLiveAutocompletion: true,
                      enableSnippets: true,
                      showLineNumbers: true,
                      tabSize: 2,
                      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="welcome-screen">
                <div className="welcome-logo">⚡</div>
                <h2>Coder Buddy IDE</h2>
                <p>Select a file from the explorer or ask the AI to generate code.</p>
                <div className="welcome-shortcuts">
                  <div className="shortcut-item">
                    <kbd>Ctrl</kbd>+<kbd>S</kbd> Save file
                  </div>
                  <div className="shortcut-item">
                    🤖 AI Assistant on the right panel
                  </div>
                </div>
              </div>
            )}

            {/* Run output panel */}
            {showRunOutput && runOutput && (
              <div className="run-output-panel">
                <div className="run-output-header">
                  <span className="run-output-title">
                    {isRunning ? '⏳' : '📤'} Output
                  </span>
                  <button className="run-output-close" onClick={() => { setShowRunOutput(false); setRunOutput(''); }}>×</button>
                </div>
                <pre className="run-output-content">{runOutput}</pre>
              </div>
            )}
          </div>

          {/* AI Chat panel (RIGHT SIDE) */}
          {chatVisible && (
            <div className="chat-pane">
              <Chatbot selectedFile={selectedFile} code={code} fileTree={fileTree} />
            </div>
          )}
        </div>

        {/* Live Preview iframe */}
        {previewVisible && (
          <div className="preview-pane">
            <div className="preview-header">
              <span className="preview-title">🔍 Live Preview</span>
              <div className="preview-actions">
                <button
                  className="preview-refresh"
                  onClick={() => {
                    const iframe = document.getElementById('preview-iframe')
                    if (iframe) iframe.src = iframe.src
                  }}
                  title="Refresh preview"
                >↻</button>
                <button className="preview-close" onClick={() => setPreviewVisible(false)}>×</button>
              </div>
            </div>
            <div className="preview-body">
              {selectedFile && selectedFile.match(/\.(html|htm)$/i) ? (
                <iframe
                  id="preview-iframe"
                  title="Live Preview"
                  src={`${API}/preview${selectedFile}?t=${Date.now()}&sid=${sessionStorage.getItem('sessionId')}`}
                  style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                  sandbox="allow-scripts allow-same-origin"
                />
              ) : (
                <div className="preview-empty">
                  <p>🔍 Open an HTML file to see a live preview</p>
                  <p className="preview-hint">Supported: .html, .htm files</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Terminal (bottom) */}
        {terminalVisible && (
          <div className="terminal-pane">
            <div className="terminal-tabs">
              <span className="terminal-tab active">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                Terminal
              </span>
              <button className="terminal-toggle" onClick={() => setTerminalVisible(false)}>×</button>
            </div>
            <div className="terminal-body">
              <Terminal />
            </div>
          </div>
        )}
      </div>
      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

export default App
