const fs = require('fs');
let code = fs.readFileSync('src/components/LyricsEditorModal.tsx', 'utf-8');
code = code.replace(/\\`\\\/api\\\/songs\\\/\\\$\\{songId\\}\\\/lyrics\\?format=\\\$\\{format\\}\\`/g, '`/api/songs/${songId}/lyrics?format=${format}`');
code = code.replace(/fetch\(\\\`/g, 'fetch(`');
code = code.replace(/\\`/g, '`');
fs.writeFileSync('src/components/LyricsEditorModal.tsx', code);
