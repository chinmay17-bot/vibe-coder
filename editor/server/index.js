// ==========================================
// 1. IMPORTS & DEPENDENCIES
// ==========================================
const http = require('http');           // Core Node.js module to create the raw HTTP server
const express = require('express');     // Web framework to handle routing and middleware
const { Server: SocketServer } = require('socket.io'); // Real-time bidirectional event-based communication
const pty = require('node-pty');        // Allows us to spawn a pseudo-terminal (like a real command line)
const os = require('os');      // Core Node.js module to check the operating system
const fs= require('fs/promises')         
const path= require('path')
const cors= require('cors')
const chokidar= require('chokidar')

// ==========================================
// 2. TERMINAL SETUP
// ==========================================
// Determine which shell to use based on the operating system.
// Windows uses PowerShell, while macOS and Linux use bash.
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

// Spawn the actual terminal process.
const ptyProcess = pty.spawn(shell, [], { // <-- Pass an empty array here instead of shellArgs
    name: 'xterm-color', 
    cols: 80,            
    rows: 30,            
    cwd: process.cwd() + '/user', 
    env: process.env  
});
// ==========================================
// 3. SERVER INITIALIZATION
// ==========================================
const app = express();
const server = http.createServer(app); // Wrap Express app in a raw HTTP server for Socket.io

// Initialize Socket.io and attach it to the HTTP server.
// CORS is set to "*" (allow all) so your frontend can connect from a different port (like localhost:3000)
const io = new SocketServer(server, {
    cors: { origin: "*" }
}); 

app.use(cors())

//used to refresh the file front end this will be called in front
chokidar.watch('./user').on('all', (event, path) =>{
    io.emit('file:refresh',path)
})

app.get('/files' , async (req, res) => {
    const fileTree= await generateFileTree('./user')
    return res.json({tree : fileTree})
})

app.get('/files/content' , async (req, res) => {
    const path= req.query.path
    const content= await fs.readFile(`./user${path}` , 'utf-8')
    return res.json({content})
})

// ==========================================
// 4. BI-DIRECTIONAL COMMUNICATION LOGIC
// ==========================================

// FLOW 1: Terminal -> Client(s)
// Whenever the pseudo-terminal outputs something (like the result of an 'ls' command),
// we catch that raw data and broadcast it to ALL connected Socket.io clients.
ptyProcess.onData(data => {
    io.emit('terminal:data', data);
});

// Listen for new frontend clients connecting to our Socket.io server
io.on('connection' , (socket) => {
    console.log(`Socket connected` , socket.id);


    // socket.emit('file:refresh')
    socket.on('file:change' , async ({path, content}) => {
        console.log('got here')
        await fs.writeFile(`./user${path}`,content)
    })
    
    // FLOW 2: Client -> Terminal
    // Listen for custom 'terminal:write' events sent from the frontend.
    socket.on('terminal:write',(data) => {
        
        ptyProcess.write(data);
    });
});


















// ==========================================
// 5. START UP
// ==========================================
// GOAL: Eventually host multiple docker instances in AWS.
server.listen(9000, () =>{
    console.log("Server is running on port 9000");
});

app.get('/files', async (req, res) => {
    const fileTree = await generateFileTree('./user')
    return res.json({tree : fileTree})
})


//HELPER FUNCTION
async function generateFileTree(directory){
    const tree = {}

    async function buildTree(currentDir, currentTree){
        const files= await fs.readdir(currentDir)

        for(const file of files){
            const filePath = path.join(currentDir, file)
            const stat= await fs.stat(filePath)

            if(stat.isDirectory()){
                currentTree[file] = {}
                await buildTree(filePath , currentTree[file])
            }else{
                currentTree[file] = null
            }
        }

    }
    await buildTree(directory, tree)
    return tree
}