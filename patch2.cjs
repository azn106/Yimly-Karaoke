const fs = require('fs');
let text = fs.readFileSync('server/db/index.ts', 'utf-8');
const migration = `  // Ensure elrc_path column exists in lyrics table
  try {
    await sqlite.execute('ALTER TABLE lyrics ADD COLUMN elrc_path text;');
    await sqlite.execute("UPDATE lyrics SET elrc_path = lrc_path, lrc_path = '' WHERE lrc_path LIKE '%.elrc.lrc'");
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure artwork_path`;
text = text.replace('  // Ensure artwork_path', migration);
fs.writeFileSync('server/db/index.ts', text);
