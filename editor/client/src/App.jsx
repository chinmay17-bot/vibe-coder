import Terminal from "./components/terminal"
import Chatbot from "./components/Chatbot"
import './App.css'
import { useEffect, useState, useCallback, useRef } from "react"
import FileTree, { ContextMenu, InlineInput } from "./components/tree"
import socket from "./socket"
import ReactAce from "react-ace";

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

function App() {
  const [fileTree, setFileTree] = useState({})
  const [selectedFile, setSelectedFile] = useState('')
  const [selectedFileContent, setSelectedFileContent] = useState('')
  const [code, setCode] = useState('')
  const [openTabs, setOpenTabs] = useState([])
  const [terminalVisible, setTerminalVisible] = useState(true)
  const [chatVisible, setChatVisible] = useState(true)
  const [ctxMenu, setCtxMenu] = useState(null)
  const [inlineInput, setInlineInput] = useState(null)
  const isSaved = selectedFileContent === code

  // Ref to always hold the latest delete handler (avoids stale closure in event listener)
  const deleteRef = useRef(null)

  const getFileTree = async () => {
    try {
      const response = await fetch('http://localhost:9000/files')
      const result = await response.json()
      setFileTree(result.tree)
    } catch (err) {
      console.error('Failed to fetch file tree:', err)
    }
  }

  // ── File management handlers (defined early so refs can capture them) ──
  const handleDeleteItem = async (filePath) => {
    try {
      const res = await fetch('http://localhost:9000/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      })
      const data = await res.json()
      if (data.success) {
        console.log('Deleted:', filePath)
        // Close tab if the deleted file was open
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

  // Keep the ref always pointing to latest handleDeleteItem
  deleteRef.current = handleDeleteItem

  const getFileContents = useCallback(async () => {
    if (!selectedFile) return
    try {
      const response = await fetch(`http://localhost:9000/files/content?path=${selectedFile}`)
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

  // Initial file tree load
  useEffect(() => { getFileTree() }, [])

  // Auto-refresh file tree on changes
  useEffect(() => {
    socket.on('file:refresh', getFileTree)
    return () => { socket.off('file:refresh', getFileTree) }
  }, [])

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
      // Use ref so we always call the latest version of handleDeleteItem
      items.push({ icon: '🗑️', label: 'Delete', action: () => deleteRef.current(path) })
      setCtxMenu({ x, y, items })
    }
    window.addEventListener('tree-context-menu', handleCtxEvent)
    return () => window.removeEventListener('tree-context-menu', handleCtxEvent)
  }, [])

  // Auto-save after 3 seconds of inactivity
  useEffect(() => {
    if (code && !isSaved && selectedFile) {
      const timer = setTimeout(() => {
        socket.emit('file:change', { path: selectedFile, content: code })
        setSelectedFileContent(code)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [code, selectedFile, isSaved])

  const handleFileSelect = (path) => {
    setSelectedFile(path)
    // Add to tabs if not already open
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

  const handleSaveNow = () => {
    if (selectedFile && code) {
      socket.emit('file:change', { path: selectedFile, content: code })
      setSelectedFileContent(code)
    }
  }

  // ── File management handlers ──
  const handleCreateItem = async (name) => {
    if (!inlineInput || !name) { setInlineInput(null); return }
    const filePath = inlineInput.parentPath + '/' + name
    try {
      await fetch('http://localhost:9000/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, isDirectory: inlineInput.type === 'folder' })
      })
      getFileTree()
    } catch (err) {
      console.error('Failed to create:', err)
    }
    setInlineInput(null)
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
              <span className={`save-status ${isSaved ? 'saved' : 'unsaved'}`}>
                {isSaved ? '✓ Saved' : '● Modified'}
              </span>
              {!isSaved && <button className="save-btn" onClick={handleSaveNow}>Save</button>}
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
                    value={code}
                    onChange={(val) => setCode(val)}
                    mode={getEditorMode(selectedFile)}
                    theme="one_dark"
                    width="100%"
                    height="100%"
                    fontSize={14}
                    showPrintMargin={false}
                    showGutter={true}
                    highlightActiveLine={true}
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
          </div>

          {/* AI Chat panel (RIGHT SIDE) */}
          {chatVisible && (
            <div className="chat-pane">
              <Chatbot />
            </div>
          )}
        </div>

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
