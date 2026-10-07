const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');

async function run() {
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';
  const token = jwt.sign({ id: 1, username: 'admin_test', role: 'administrator' }, JWT_SECRET);
  
  // Create a mock TTF (valid magic bytes)
  const mockTtf = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x00, 0x00]),
    Buffer.from('dummy font data')
  ]);
  
  console.log('--- 1. Uploading Font ---');
  const uploadRes = await fetch('http://localhost:3000/api/karaoke/settings/lyrics/custom-font?filename=test_font.ttf', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'font/ttf',
      'x-font-filename': 'test_font.ttf'
    },
    body: mockTtf
  });
  
  const uploadData = await uploadRes.json();
  console.log('Upload Status:', uploadRes.status);
  console.log('Upload Response:', uploadData);
  
  if (uploadRes.status !== 200) {
    console.error('Upload failed!');
    return;
  }
  
  const fontId = uploadData.fontId;
  console.log('\n--- 2. Checking File System ---');
  const fontPath = path.join(__dirname, 'data', 'fonts', fontId);
  const exists = fs.existsSync(fontPath);
  console.log('File created on disk?', exists);
  
  console.log('\n--- 3. Checking Database / Settings API ---');
  const settingsRes = await fetch('http://localhost:3000/api/karaoke/settings/lyrics', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const settingsData = await settingsRes.json();
  console.log('Settings API fontId:', settingsData.settings.customFontId);
  console.log('Settings API match?', settingsData.settings.customFontId === fontId);
  
  console.log('\n--- 4. Checking Font Serving API ---');
  const serveRes = await fetch(`http://localhost:3000/api/karaoke/settings/lyrics/custom-font/${fontId}`);
  console.log('Serve API Status:', serveRes.status);
  console.log('Serve API Content-Type:', serveRes.headers.get('content-type'));
  
}
run().catch(console.error);
