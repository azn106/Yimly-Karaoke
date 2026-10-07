const fs = require('fs');
let code = fs.readFileSync('src/pages/Library.tsx', 'utf-8');

// Remove from middle
code = code.replace(/<LyricsEditorModal[\s\S]*?onSave=\{loadAllData\}\s*\/>/g, '');
code = code.replace(/<LyricsEditorModal[\s\S]*?onSave=\{fetchSongs\}\s*\/>/g, '');

// Put at the very end before last </div>
const endTag = '    </div>\n  );\n}';
const modalHtml = `      <LyricsEditorModal
        isOpen={editorState.isOpen}
        songId={editorState.songId}
        songTitle={editorState.title}
        format={editorState.format}
        onClose={() => setEditorState(prev => ({ ...prev, isOpen: false }))}
        onSave={() => {
          if (typeof loadAllData === 'function') loadAllData();
        }}
      />
`;
code = code.replace(endTag, modalHtml + endTag);
fs.writeFileSync('src/pages/Library.tsx', code);
