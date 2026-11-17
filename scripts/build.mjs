// Builds the single-file game: src/worms.html + PeerJS + three.js + transport + optional voice pack -> index.html
// Relay (optional): WORMS_RELAY=wss://your-worker.workers.dev npm run build   or put {"relay":"wss://..."} in config.local.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const rd = p => readFileSync(new URL(p, root), 'utf8');
let relay = process.env.WORMS_RELAY || '';
if (!relay && existsSync(new URL('config.local.json', root))) relay = JSON.parse(rd('config.local.json')).relay || '';
const noVoices = process.env.NO_VOICES === '1';
const tag = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>';
let html = rd('src/worms.html');
if (html.split(tag).length !== 2) throw new Error('three.js script tag not found exactly once in src/worms.html');
let transport = rd('src/transport.js');
if (relay) {
  if (!/^wss?:\/\//.test(relay)) throw new Error('relay must start with ws:// or wss://');
  transport = transport.replace(/window\.WORMS_RELAY=window\.WORMS_RELAY\|\|'';/, `window.WORMS_RELAY=window.WORMS_RELAY||${JSON.stringify(relay)};`);
}
const peer = rd('node_modules/peerjs/dist/peerjs.min.js'), three = rd('node_modules/three/build/three.min.js');
const voices = !noVoices && existsSync(new URL('voices/voices.js', root)) ? rd('voices/voices.js') : '';
for (const [n, s] of Object.entries({ peer, three, transport, voices })) if (s.includes('</script')) throw new Error(n + ' contains </script');
const inline = (voices ? `<script>${voices}</script>\n` : '') + `<script>${peer}\n</script>\n<script>\n${transport}</script>\n<script>${three}\n</script>`;
html = html.replace(tag, () => inline);
writeFileSync(new URL('index.html', root), html);
console.log(`index.html  ${(html.length / 1024 / 1024).toFixed(2)} MB  relay=${relay || '(none: PeerJS/tabs only)'}  voices=${voices ? 'yes' : 'no'}`);
