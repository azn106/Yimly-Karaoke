const fs = require('fs');
let code = fs.readFileSync('src/components/LyricsEditorModal.tsx', 'utf-8');
code = code.replace(/\\\$\{/g, '${');
fs.writeFileSync('src/components/LyricsEditorModal.tsx', code);
