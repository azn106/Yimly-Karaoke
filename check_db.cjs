const { drizzle } = require('drizzle-orm/libsql');
const { createClient } = require('@libsql/client');
const sqlite = createClient({ url: 'file:media/library.db' });
const db = drizzle(sqlite);
async function run() {
  const res = await sqlite.execute('SELECT * FROM lyrics LIMIT 10;');
  console.log("Lyrics table sample:", res.rows);
}
run();
