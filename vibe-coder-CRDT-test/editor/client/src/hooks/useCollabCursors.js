import { useEffect, useRef, useState } from 'react';
import socket from '../socket';

// Distinct colors for remote cursors
const COLORS = [
    '#f97316', '#8b5cf6', '#ec4899', '#06b6d4',
    '#84cc16', '#f59e0b', '#ef4444', '#14b8a6',
];

const colorMap = new Map(); // socketId -> color
let colorIndex = 0;

function getColor(socketId) {
    if (!colorMap.has(socketId)) {
        colorMap.set(socketId, COLORS[colorIndex % COLORS.length]);
        colorIndex++;
    }
    return colorMap.get(socketId);
}

/**
 * useCollabCursors
 * @param {object} aceEditor - the Ace editor instance
 * @param {string} selectedFile - currently open file path
 * @returns {{ remoteCursors: Map }} map of socketId -> { row, col, color, file }
 */
export function useCollabCursors(aceEditor, selectedFile) {
    const [remoteCursors, setRemoteCursors] = useState(new Map());
    const markersRef = useRef(new Map()); // socketId -> markerId

    // Broadcast our cursor position on every cursor change
    useEffect(() => {
        if (!aceEditor || !selectedFile) return;

        const session = aceEditor.getSession();
        const selection = aceEditor.getSelection();

        const onCursorChange = () => {
            const pos = selection.getCursor();
            socket.emit('cursor:move', {
                file: selectedFile,
                row: pos.row,
                col: pos.column,
            });
        };

        selection.on('changeCursor', onCursorChange);
        return () => selection.off('changeCursor', onCursorChange);
    }, [aceEditor, selectedFile]);

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
            setRemoteCursors(prev => {
                const next = new Map(prev);
                next.delete(socketId);
                return next;
            });
        };

        socket.on('cursor:update', handleUpdate);
        socket.on('cursor:leave', handleLeave);
        return () => {
            socket.off('cursor:update', handleUpdate);
            socket.off('cursor:leave', handleLeave);
        };
    }, []);

    // Render markers in the Ace editor
    useEffect(() => {
        if (!aceEditor) return;
        const session = aceEditor.getSession();
        const Range = window.ace?.require('ace/range')?.Range;
        if (!Range) return;

        // Remove old markers
        for (const [, markerId] of markersRef.current) {
            session.removeMarker(markerId);
        }
        markersRef.current.clear();

        // Add markers for cursors in the current file
        for (const [socketId, cursor] of remoteCursors) {
            if (cursor.file !== selectedFile) continue;
            const { row, col, color } = cursor;

            // Inject a CSS class for this cursor color
            const className = `collab-cursor-${socketId.replace(/[^a-z0-9]/gi, '')}`;
            injectCursorStyle(className, color);

            const range = new Range(row, col, row, col + 1);
            const markerId = session.addMarker(range, className, 'text', true);
            markersRef.current.set(socketId, markerId);
        }
    }, [remoteCursors, aceEditor, selectedFile]);

    return { remoteCursors };
}

const injectedStyles = new Set();
function injectCursorStyle(className, color) {
    if (injectedStyles.has(className)) return;
    injectedStyles.add(className);
    const style = document.createElement('style');
    style.textContent = `
        .${className} {
            position: absolute;
            border-left: 2px solid ${color};
            z-index: 5;
        }
        .${className}::before {
            content: '';
            position: absolute;
            top: -4px;
            left: -4px;
            width: 8px;
            height: 8px;
            background: ${color};
            border-radius: 50%;
        }
    `;
    document.head.appendChild(style);
}
