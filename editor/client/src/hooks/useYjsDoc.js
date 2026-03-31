import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export function useYjsDoc(sessionId, filePath, initialContent) {
    const providerRef = useRef(null);
    const [ytext, setYtext] = useState(null);
    const [synced, setSynced] = useState(false);

    useEffect(() => {
        if (!sessionId || !filePath) return;

        const docName = `${sessionId}/${filePath.replace(/^\//, '')}`;

        // Clean up previous
        if (providerRef.current) { providerRef.current.destroy(); providerRef.current = null; }
        setYtext(null);
        setSynced(false);

        const doc = new Y.Doc();
        const yt = doc.getText('content');
        setYtext(yt);

        const provider = new WebsocketProvider('ws://localhost:1234', docName, doc, {
            connect: true,
            resyncInterval: -1,
        });
        providerRef.current = provider;

        provider.on('sync', (isSynced) => {
            if (!isSynced) return;
            if (yt.length === 0 && initialContent) {
                doc.transact(() => yt.insert(0, initialContent));
            }
            setSynced(true);
        });

        return () => {
            provider.destroy();
            doc.destroy();
            providerRef.current = null;
            setYtext(null);
            setSynced(false);
        };
    }, [sessionId, filePath]);

    return { ytext, synced };
}
