const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf-8');
code = code.replace(/hasLrc\?: boolean;/g, 'hasLrc?: boolean;\n  hasElrc?: boolean;');
fs.writeFileSync('src/types.ts', code);
