// Smoke test: opens index.html, checks the start screen, starts a bot match through the lobby and checks for page errors.
// Usage: npm run build && npm test   (set CHROME=/path/to/chrome to use a system browser)
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const url = 'file://' + fileURLToPath(new URL('../index.html', import.meta.url)) + '?p2p=0';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
let failed = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed++; };
await page.goto(url); await page.waitForTimeout(500);
ok(await page.title() === 'Worms Rox!', 'title is "Worms Rox!"');
ok(await page.isVisible('#hero'), 'hero banner visible on start screen');
ok(!(await page.isVisible('#cw')), 'game canvas hidden before a game starts');
ok(await page.isVisible('#ob') && await page.isVisible('#onw'), 'lobby: start-open-room button and match options visible');
await page.fill('#nm', 'Tester'); await page.selectOption('#onw', '2');
await page.click('#ob');
try { await page.waitForFunction(() => typeof G !== 'undefined' && G && G.W && document.body.classList.contains('playing'), null, { timeout: 30000 }); } catch (e) { }
await page.waitForTimeout(1000);
const s = await page.evaluate(() => ({ g: typeof G !== 'undefined' && !!G, worms: typeof G !== 'undefined' && G ? G.W.length : 0, playing: document.body.classList.contains('playing') }));
ok(s.g && s.playing, 'bot match started from the lobby'); ok(s.worms === 4, '2 worms per team = 4 worms');
ok(await page.isVisible('#cw'), 'canvas visible during the game');
ok(await page.evaluate(() => RAD.st.length > 5), 'radio stations loaded');
ok(await page.evaluate(() => WV && WV.n === 2), 'voice pack present');
ok(await page.evaluate(() => typeof ISLAND_B64 === 'string' && ISLAND_B64.length > 100000), 'Worm Island is embedded');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await browser.close(); process.exit(failed ? 1 : 0);
