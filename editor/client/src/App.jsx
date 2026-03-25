import Terminal from "./components/terminal"
import '../src/App.css'
import { useEffect, useState } from "react"
import FileTree from "./components/tree"
import socket from "./socket"
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
  const isSaved = selectedFileContent === code


  const getFileTree = async () =>{
    const response= await fetch('http://localhost:9000/files')
    const result= await response.json()

    setFileTree(result.tree)
  }

  const getFileContents = useCallback(async () =>{
    if(!selectedFile) return
    const response= await fetch(`http://localhost:9000/files/content?path=${selectedFile}`)
    const result= await response.json()

    setSelectedFileContent(result.content)
  },[selectedFile]) 

  useEffect(()=> {
    if(selectedFile && selectedFileContent){
      setCode(selectedFileContent)
    }    
  }, [selectedFile, selectedFileContent])

  useEffect(() => {
    if(selectedFile) getFileContents()
  } , [getFileContents , selectedFile])
  

  useEffect(() =>{
    getFileTree()
  },[])

  
  useEffect(() =>{
    socket.on('file:refresh', getFileTree)
    return () => {
      socket.off('file:refresh',getFileTree)
    }
  },[])

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
