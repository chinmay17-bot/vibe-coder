import { Terminal as XTerminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import socket from '../socket'

const Terminal = () => {
    const terminalRef = useRef()
    const isRendered = useRef(false)

    useEffect(() => {
        if (isRendered.current) return
        isRendered.current = true

        const term = new XTerminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            theme: {
                background: '#0d1117',
                foreground: '#e6edf3',
                cursor: '#58a6ff',
                selectionBackground: '#264f78',
                black: '#0d1117',
                red: '#f85149',
                green: '#3fb950',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#39d353',
                white: '#e6edf3',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#56d364',
                brightWhite: '#ffffff',
            },
            allowProposedApi: true,
        })

        term.open(terminalRef.current)

        // Fit terminal to container
        const fitTerminal = () => {
            const container = terminalRef.current
            if (!container) return

            const dims = term._core._renderService.dimensions
            if (!dims || !dims.css || !dims.css.cell) return

            const cellWidth = dims.css.cell.width
            const cellHeight = dims.css.cell.height
            if (!cellWidth || !cellHeight) return

            const cols = Math.max(10, Math.floor(container.clientWidth / cellWidth))
            const rows = Math.max(2, Math.floor(container.clientHeight / cellHeight))

            term.resize(cols, rows)
            socket.emit('terminal:resize', { cols, rows })
        }

        // Fit after a delay to ensure container is sized
        setTimeout(fitTerminal, 200)

        // Re-fit on window resize
        const resizeObserver = new ResizeObserver(() => {
            setTimeout(fitTerminal, 50)
        })
        if (terminalRef.current) {
            resizeObserver.observe(terminalRef.current)
        }

        // Terminal → Server
        term.onData(data => {
            socket.emit('terminal:write', data)
        })

        // Server → Terminal
        socket.on('terminal:data', (data) => {
            term.write(data)
        })

        return () => {
            resizeObserver.disconnect()
        }
    }, [])

    return (
        <div ref={terminalRef} id='terminal' style={{ width: '100%', height: '100%' }} />
    )
}

export default Terminal