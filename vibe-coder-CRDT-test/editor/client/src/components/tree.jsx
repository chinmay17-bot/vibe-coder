import { useState, useRef, useEffect } from 'react';

const EXT_ICONS = {
  js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
  py: '🐍', html: '🌐', css: '🎨', json: '📋',
  java: '☕', c: '🔧', cpp: '🔧', h: '🔧',
  md: '📝', yaml: '⚙️', yml: '⚙️', sh: '💲',
  txt: '📄', env: '🔒', gitignore: '📌',
};

const LANG_BADGES = {
  js: { label: 'JS', color: '#f7df1e', textColor: '#000' },
  jsx: { label: 'JSX', color: '#61dafb', textColor: '#000' },
  ts: { label: 'TS', color: '#3178c6', textColor: '#fff' },
  tsx: { label: 'TSX', color: '#3178c6', textColor: '#fff' },
  py: { label: 'PY', color: '#3572A5', textColor: '#fff' },
  html: { label: 'HTML', color: '#e34c26', textColor: '#fff' },
  css: { label: 'CSS', color: '#563d7c', textColor: '#fff' },
  json: { label: 'JSON', color: '#6e7681', textColor: '#fff' },
  java: { label: 'JAVA', color: '#b07219', textColor: '#fff' },
  c: { label: 'C', color: '#555555', textColor: '#fff' },
  cpp: { label: 'C++', color: '#f34b7d', textColor: '#fff' },
  h: { label: 'H', color: '#555555', textColor: '#fff' },
  md: { label: 'MD', color: '#083fa1', textColor: '#fff' },
  yaml: { label: 'YML', color: '#cb171e', textColor: '#fff' },
  yml: { label: 'YML', color: '#cb171e', textColor: '#fff' },
  sh: { label: 'SH', color: '#89e051', textColor: '#000' },
};

function getIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  return EXT_ICONS[ext] || '📄';
}

function getLangBadge(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  return LANG_BADGES[ext] || null;
}

// ── Context Menu ──
const ContextMenu = ({ x, y, items, onClose }) => {
  const ref = useRef();

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-menu" style={{ top: y, left: x }}>
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="ctx-divider" />
        ) : (
          <div key={i} className="ctx-item" onClick={() => { item.action(); onClose(); }}>
            <span className="ctx-icon">{item.icon}</span>
            <span>{item.label}</span>
          </div>
        )
      )}
    </div>
  );
};

// ── Inline Input (for new file/folder name) ──
const InlineInput = ({ onSubmit, onCancel, placeholder }) => {
  const [value, setValue] = useState('');
  const ref = useRef();

  useEffect(() => { ref.current?.focus(); }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && value.trim()) { onSubmit(value.trim()); }
    if (e.key === 'Escape') { onCancel(); }
  };

  return (
    <input
      ref={ref}
      className="tree-inline-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      placeholder={placeholder}
    />
  );
};

// ── File Tree Node ──
const FileTreeNode = ({ fileName, nodes, onSelect, path, depth = 0, onCreateFile, onCreateFolder, onDelete }) => {
  const [expanded, setExpanded] = useState(true);
  const isDir = !!nodes;

  const handleClick = (e) => {
    e.stopPropagation();
    if (isDir) {
      setExpanded(prev => !prev);
    } else {
      onSelect(path);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Use custom event to show context menu at App level
    const event = new CustomEvent('tree-context-menu', {
      detail: { x: e.clientX, y: e.clientY, path, isDir, fileName }
    });
    window.dispatchEvent(event);
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${!isDir ? 'tree-file' : 'tree-dir'}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        title={path}
      >
        {isDir && (
          <span className={`tree-chevron ${expanded ? 'open' : ''}`}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3z" fill="currentColor" /></svg>
          </span>
        )}
        {isDir ? (
          <span className="tree-dir-icon">{expanded ? '📂' : '📁'}</span>
        ) : (
          <span className="tree-file-icon">{getIcon(fileName)}</span>
        )}
        <span className="tree-label">{fileName}</span>
        {!isDir && (() => {
          const badge = getLangBadge(fileName);
          return badge ? (
            <span
              className="tree-lang-badge"
              style={{ backgroundColor: badge.color, color: badge.textColor }}
            >
              {badge.label}
            </span>
          ) : null;
        })()}
      </div>

      {isDir && expanded && nodes && (
        <div className="tree-children">
          {Object.keys(nodes).sort((a, b) => {
            const aIsDir = !!nodes[a];
            const bIsDir = !!nodes[b];
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.localeCompare(b);
          }).map((child) => (
            <FileTreeNode
              key={child}
              fileName={child}
              onSelect={onSelect}
              path={path + '/' + child}
              nodes={nodes[child]}
              depth={depth + 1}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main File Tree Component ──
const FileTree = ({ tree, onSelect, onCreateFile, onCreateFolder, onDelete }) => {
  if (!tree || Object.keys(tree).length === 0) {
    return <div className="tree-empty">No files yet</div>;
  }

  return (
    <div className="tree-root">
      {Object.keys(tree).sort((a, b) => {
        const aIsDir = !!tree[a];
        const bIsDir = !!tree[b];
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.localeCompare(b);
      }).map((child) => (
        <FileTreeNode
          key={child}
          fileName={child}
          onSelect={onSelect}
          path={'/' + child}
          nodes={tree[child]}
          depth={0}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

export { ContextMenu, InlineInput };
export default FileTree;
