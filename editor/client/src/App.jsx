import Terminal from "./components/terminal"
import '../src/App.css'
import { useEffect, useState } from "react"
import FileTree from "./components/tree"
import socket, { sessionReady } from "./socket"
import ReactAce from "react-ace";



import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/ext-language_tools";
const AceEditor = ReactAce.default || ReactAce;


import ace from "ace-builds";
import { useCallback } from "react"

// Tell Ace to grab any missing dynamic files from a public CDN
ace.config.set("basePath", "https://cdn.jsdelivr.net/npm/ace-builds@1.32.2/src-noconflict/");
function App() {

  const [fileTree, setFileTree]= useState({})
  const [selectedFile, setSelectedFile] = useState('')
  const [selectedFileContent, setSelectedFileContent] = useState('')
  const [code, setCode] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [sessionStatus, setSessionStatus] = useState('connecting') // 'connecting' | 'provisioning' | 'ready' | 'error'
  const [statusMessage, setStatusMessage] = useState('Connecting to server...')
  const isSaved = selectedFileContent === code

  // Listen for session status updates from the server
  useEffect(() => {
    socket.on('session:status', (data) => {
      setSessionStatus(data.status)
      setStatusMessage(data.message)
      if (data.status === 'ready') {
        setSessionId(socket.id)
      }
    })

    socket.on('session:error', (data) => {
      console.error('Session error:', data.message)
    })

    // Wait for session to be ready
    sessionReady.then((id) => {
      setSessionId(id)
    })

    return () => {
      socket.off('session:status')
      socket.off('session:error')
    }
  }, [])


  const getFileTree = useCallback(async () =>{
    if (!sessionId) return
    const response= await fetch(`http://localhost:9000/files?sessionId=${sessionId}`)
    const result= await response.json()

    setFileTree(result.tree)
  }, [sessionId])

  const getFileContents = useCallback(async () =>{
    if(!selectedFile || !sessionId) return
    const response= await fetch(`http://localhost:9000/files/content?sessionId=${sessionId}&path=${selectedFile}`)
    const result= await response.json()

    setSelectedFileContent(result.content)
  },[selectedFile, sessionId]) 

  useEffect(()=> {
    if(selectedFile && selectedFileContent){
      setCode(selectedFileContent)
    }    
  }, [selectedFile, selectedFileContent])

  useEffect(() => {
    if(selectedFile) getFileContents()
  } , [getFileContents , selectedFile])
  

  useEffect(() =>{
    if (sessionId) getFileTree()
  },[sessionId])

  
  useEffect(() =>{
    socket.on('file:refresh', getFileTree)
    return () => {
      socket.off('file:refresh',getFileTree)
    }
  },[getFileTree])

  useEffect(()=>{
    if(code && !isSaved){
      const timer = setTimeout(() =>{
        console.log('save code', code)
        socket.emit('file:change',{
          path:selectedFile,
          content:code
        })
      }, 5*1000)

      return () => {
        clearTimeout(timer)
      } 
    }
  },[code, selectedFile, isSaved])

  // Show loading screen while container is being provisioned
  if (sessionStatus !== 'ready') {
    return (
      <div className="playground-container" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '16px',
        color: '#ccc',
        background: '#1e1e1e',
      }}>
        {sessionStatus === 'error' ? (
          <>
            <div style={{ fontSize: '48px' }}>⚠️</div>
            <h2 style={{ margin: 0 }}>Failed to create workspace</h2>
            <p style={{ margin: 0, color: '#999' }}>{statusMessage}</p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 24px',
                borderRadius: '6px',
                border: 'none',
                background: '#4a9eff',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <div className="spinner" style={{
              width: '40px',
              height: '40px',
              border: '3px solid #333',
              borderTop: '3px solid #4a9eff',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
            <h2 style={{ margin: 0 }}>{statusMessage}</h2>
            <p style={{ margin: 0, color: '#666', fontSize: '13px' }}>
              Setting up your isolated Docker workspace...
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="playground-container">
      <div className="editor-container">
        
      <div className="chatbot-container">

{/* ================================================================================================== */}
{/* ================================================================================================== */}

      {/* chatbot must be here */}
      {/* All the output from the chat bot must br returned back to the chat box as well as create files in ./server/user */}



{/* ================================================================================================== */}
{/* ================================================================================================== */}
      </div>
        <div className="files">
          <FileTree onSelect={(path)=>setSelectedFile(path)} tree= {fileTree}/>
        </div>
        <div className="editor">
          {selectedFile && <p>{selectedFile.replaceAll('/',' >')} {isSaved ? 'Saved' : 'Unsaved'}</p>}
          <AceEditor value={code} onChange={(e) => setCode(e)}/>
        </div>
      </div>
      <div className="terminal-container">
        <Terminal/>
      </div>
    </div>
  )
}

export default App
