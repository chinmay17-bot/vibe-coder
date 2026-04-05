import { useEffect, useRef, useState } from 'react';
import socket from '../socket';
import ace from 'ace-builds';

const COLORS = [
    '#f97316', '#8b5cf6', '#ec4899', '#06b6d4',
    '#84cc16', '#f59e0b', '#ef4444', '#14b8a6',
];

const colorMap = new Map();
let colorIndex = 0;

function getColor(socketId) {
    if (!colorMap.has(socketId)) {
        colorMap.set(socketId, COLORS[colorIndex % COLORS.length]);
        colorIndex++;
    }
    return colorMap.get(socketId);
}

export function useCollabCursors(aceEditorRef, selectedFile) {
    const [remoteCursors, setRemoteCursors] = useState(new Map());
    const markersRef = useRef(new Map());

    // Broadcast our cursor position
    useEffect(() => {
        const aceEditor = aceEditorRef?.current;
        if (!aceEditor || !selectedFile) return;
        const selection = aceEditor.getSelection();
        const onCursorChange = () => {
            const pos = selection.getCursor();
            socket.emit('cursor:move', { file: selectedFile, row: pos.row, col: pos.column });
        };
        selection.on('changeCursor', onCursorChange);
        return () => selection.off('changeCursor', onCursorChange);
    }, [aceEditorRef?.current, selectedFile]);

    // Listen for remote cursor updates
    useEffect(() => {
        const handleUpdate = ({ socketId, file, row, col }) => {
            setRemoteCursors(prev => {
                const next = new Map(prev);
                next.set(socketId, { file, row, col, color: getColor(socketId) });
                return next;
            });
        };
        const handleLeave = ({ socketId }) => {
            colorMap.delete(socketId);
            setRemoteCursors(prev => { const next = new Map(prev); next.delete(socketId); return next; });
        };
        socket.on('cursor:update', handleUpdate);
        socket.on('cursor:leave', handleLeave);
        return () => { socket.off('cursor:update', handleUpdate); socket.off('cursor:leave', handleLeave); };
    }, []);

    // Render markers in Ace
    useEffect(() => {
        const aceEditor = aceEditorRef?.current;
        if (!aceEditor) return;
        const aceSession = aceEditor.getSession();
        const Range = ace.require('ace/range').Range;

        // Remove old markers
        for (const [, markerId] of markersRef.current) aceSession.removeMarker(markerId);
        markersRef.current.clear();

        // Add markers for cursors in the current file
        for (const [socketId, cursor] of remoteCursors) {
            if (cursor.file !== selectedFile) continue;
            const { row, col, color } = cursor;
            const className = `collab-cursor-${socketId.replace(/[^a-z0-9]/gi, '')}`;
            injectCursorStyle(className, color);
            const range = new Range(row, col, row, col + 1);
            const markerId = aceSession.addMarker(range, className, 'text', true);
            markersRef.current.set(socketId, markerId);
        }
    }, [remoteCursors, aceEditorRef?.current, selectedFile]);

    return { remoteCursors };
}

const injectedStyles = new Set();
function injectCursorStyle(className, color) {
    if (injectedStyles.has(className)) return;
    injectedStyles.add(className);
    const style = document.createElement('style');
    style.textContent = `
        .${className} { position: absolute; border-left: 2px solid ${color}; z-index: 5; }
        .${className}::before { content: ''; position: absolute; top: -4px; left: -4px;
            width: 8px; height: 8px; background: ${color}; border-radius: 50%; }
    `;
    document.head.appendChild(style);
}
