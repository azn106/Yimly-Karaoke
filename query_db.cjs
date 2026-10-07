const { createClient } = require('@libsql/client');
async function run() {
  const sqlite = createClient({ url: 'file:media/library.db' });
  const res = await sqlite.execute('SELECT * FROM lyrics LIMIT 5;');
  console.log(res);
}
run();
