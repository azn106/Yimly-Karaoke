const { createClient } = require('@libsql/client');
async function run() {
  const sqlite = createClient({ url: 'file:data/yimly.db' });
  const res = await sqlite.execute('SELECT lrc_path, elrc_path FROM lyrics LIMIT 10;');
  console.log("Lyrics table:", res.rows);
}
run();
