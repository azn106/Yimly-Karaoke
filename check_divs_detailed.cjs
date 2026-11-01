const fs = require('fs');
const content = fs.readFileSync('src/pages/Settings.tsx', 'utf8');

let divBalance = 0;
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const opens = (line.match(/<div/g) || []).length;
  const closes = (line.match(/<\/div/g) || []).length;
  divBalance += opens - closes;
  if (i % 100 === 0) {
    console.log(`Line ${i+1}: balance=${divBalance}`);
  }
}

console.log(`Final div balance: ${divBalance}`);
