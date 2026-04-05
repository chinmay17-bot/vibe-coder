import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/**
 * useYjsDoc
 * Returns a Y.Text bound to the given file in the given session.
 * All tabs connected to the same docName share the same CRDT state.
 */
export function useYjsDoc(sessionId, filePath, initialContent) {
    const docRef = useRef(null);
    const providerRef = useRef(null);
    const ytextRef = useRef(null);
    const [synced, setSynced] = useState(false);

    useEffect(() => {
        if (!sessionId || !filePath) return;

        // Unique doc name per session + file
        const docName = `${sessionId}/${filePath.replace(/^\//, '')}`;

        // Clean up previous doc
        if (providerRef.current) providerRef.current.destroy();
        if (docRef.current) docRef.current.destroy();
        setSynced(false);

        const doc = new Y.Doc();
        const ytext = doc.getText('content');
        docRef.current = doc;
        ytextRef.current = ytext;

        const YJS_URL = (window.__ENV__ && window.__ENV__.VITE_YJS_URL) || 'ws://localhost:1234';
        const provider = new WebsocketProvider(
            YJS_URL,
            docName,
            doc
        );
        providerRef.current = provider;

        provider.on('sync', (isSynced) => {
            if (isSynced) {
                // If doc is empty (first user), seed with file content from disk
                if (ytext.length === 0 && initialContent) {
                    doc.transact(() => {
                        ytext.insert(0, initialContent);
                    });
                }
                setSynced(true);
            }
        });

        return () => {
            provider.destroy();
            doc.destroy();
        };
    }, [sessionId, filePath]);

    return { ytext: ytextRef.current, synced, doc: docRef.current };
}
