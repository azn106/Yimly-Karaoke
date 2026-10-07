const fs = require('fs');
let code = fs.readFileSync('src/pages/Library.tsx', 'utf-8');
code = code.replace(/onSave=\{fetchSongs\}/g, 'onSave={loadAllData}');
fs.writeFileSync('src/pages/Library.tsx', code);
