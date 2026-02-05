import fs from 'node:fs';
import path from 'node:path';

const files = [
  'AGENTS.md',
  'master_prompt.md',
];

let ok = true;
for (const file of files) {
  const fullPath = path.join(process.cwd(), file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing required file: ${file}`);
    ok = false;
    continue;
  }
  const content = fs.readFileSync(fullPath, 'utf-8').trim();
  if (!content) {
    console.error(`File is empty: ${file}`);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log('lint ok');
