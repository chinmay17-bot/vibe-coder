const FileTreeNode = ({ fileName, nodes, onSelect , path }) => {
    const isDir = !!nodes;

    return (
        <div onClick={
            (e) =>{
                e.stopPropagation()
                if(isDir) return
                onSelect(path)

            }
        } style={{ paddingLeft: '15px', fontFamily: 'monospace' }}>
            <span>{isDir ? '📁' : '📄'} {fileName}</span>
            
            {nodes && (
                <ul style={{ listStyleType: 'none', paddingLeft: '10px', margin: 0 }}>
                    {Object.keys(nodes).map((child) => (
                        <li key={child}>
                            <FileTreeNode 
                                fileName={child} 
                                onSelect={onSelect}
                                path={path+'/'+child}
                                nodes={nodes[child]} 
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const FileTree = ({tree , onSelect}) =>{
    return (
        <FileTreeNode
            fileName='/'
            path=''
            onSelect={onSelect}
            nodes={tree}
        />
    )
}

export default FileTree
