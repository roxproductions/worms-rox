// Rebuild voices/lines.json from the LINES table in src/worms.html (run after adding/changing voice lines).
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('src/worms.html', root), 'utf8');
const m = src.match(/const LINES=(\{[\s\S]*?\});\nfunction chat/);
if (!m) throw new Error('LINES table not found in src/worms.html');
const lines = [...new Set(Object.values(new Function('return ' + m[1])()).flat())];
writeFileSync(new URL('voices/lines.json', root), JSON.stringify(lines));
console.log(lines.length, 'unique lines -> voices/lines.json');
