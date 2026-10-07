const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const db = new Database('data/yimly.db');
const users = db.prepare('SELECT * FROM users WHERE role = ?').all('administrator');
console.log('Admins:', users);

if (users.length > 0) {
  const admin = users[0];
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET);
  console.log('Admin Token:', token);
}
