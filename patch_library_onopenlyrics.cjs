const fs = require('fs');
let code = fs.readFileSync('src/pages/Library.tsx', 'utf-8');

code = code.replace(/queuedSongId=\{queuedSongId\}\s*playingAll=\{playingAll\}\s*\/>/g, `queuedSongId={queuedSongId}
          playingAll={playingAll}
          onOpenLyrics={(songId, title, format) => {
            setEditorState({ isOpen: true, songId, title, format });
          }}
        />`);

fs.writeFileSync('src/pages/Library.tsx', code);
