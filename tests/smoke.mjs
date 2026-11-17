// Smoke test: opens index.html, checks the start screen, starts a bot game and checks for page errors.
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
ok(await page.isVisible('#setup'), 'match options visible on start screen');
await page.fill('#nm', 'Tester'); await page.selectOption('#on', '2'); await page.selectOption('#oland', 'canyon');
await page.click('#bt'); await page.waitForTimeout(4000);
const s = await page.evaluate(() => ({ g: !!G, worms: G && G.W.length, playing: document.body.classList.contains('playing') }));
ok(s.g && s.playing, 'bot game started'); ok(s.worms === 4, '2 worms per team = 4 worms');
ok(await page.isVisible('#cw'), 'canvas visible during the game');
ok(await page.evaluate(() => RAD.st.length > 5), 'radio stations loaded');
ok(await page.evaluate(() => WV && WV.n === 2), 'voice pack present');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await browser.close(); process.exit(failed ? 1 : 0);
