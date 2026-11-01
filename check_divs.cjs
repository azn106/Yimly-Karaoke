const fs = require('fs');
const content = fs.readFileSync('src/pages/Settings.tsx', 'utf8');

let divBalance = 0;
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const opens = (line.match(/<div/g) || []).length;
  const closes = (line.match(/<\/div/g) || []).length;
  divBalance += opens - closes;
  if (opens !== 0 || closes !== 0) {
    // console.log(`Line ${i+1}: opens=${opens}, closes=${closes}, balance=${divBalance}`);
  }
  if (divBalance < 0) {
    console.log(`Extra </div> at line ${i+1}`);
  }
}

console.log(`Final div balance: ${divBalance}`);
