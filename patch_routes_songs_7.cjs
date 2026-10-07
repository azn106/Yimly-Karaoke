const fs = require('fs');
let code = fs.readFileSync('server/routes/songs.ts', 'utf-8');

code = code.replace(
`await persistMatchedPath(filePath);`,
`await persistMatchedPath(filePath, false);`
);
code = code.replace(
`await persistMatchedPath(filePath);`,
`await persistMatchedPath(filePath, false);`
);

fs.writeFileSync('server/routes/songs.ts', code);
