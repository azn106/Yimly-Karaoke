const fs = require('fs');
const content = fs.readFileSync('src/pages/Settings.tsx', 'utf8');

let braces = 0;
let parens = 0;
let brackets = 0;

for (let i = 0; i < content.length; i++) {
  const char = content[i];
  if (char === '{') braces++;
  else if (char === '}') braces--;
  else if (char === '(') parens++;
  else if (char === ')') parens--;
  else if (char === '[') brackets++;
  else if (char === ']') brackets--;

  if (braces < 0) console.log(`Extra } at char ${i}`);
  if (parens < 0) console.log(`Extra ) at char ${i}`);
  if (brackets < 0) console.log(`Extra ] at char ${i}`);
}

console.log(`Braces balance: ${braces}`);
console.log(`Parens balance: ${parens}`);
console.log(`Brackets balance: ${brackets}`);
