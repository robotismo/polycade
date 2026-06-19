// Smoke-test the LIVE deployment: boot the app, play a game, assert scoring +
// game-over + high-score persistence on the real URL.
import { chromium } from '@playwright/test';

const BASE = (process.env.BASE || 'https://robotismo.github.io/polycade').replace(/\/$/, '');
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext()).newPage();

// Asset 200 check.
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.polycade, undefined, { timeout: 20000 });
const cards = await page.locator('.card').count();

// Play Updraft on the live site.
await page.evaluate(() => (location.hash = '#/play/updraft'));
await page.waitForFunction(() => window.polycade.currentId() === 'updraft' && window.polycade.state() === 'ready');
const result = await page.evaluate(() => {
  const p = window.polycade;
  p.stopLoop();
  p.start();
  const g = p.game();
  const flap = () => { p.input.virtualDown('flap'); p.input.virtualUp('flap'); };
  let s = 0;
  for (; s < 8000 && p.score() < 4 && p.state() === 'playing'; s++) {
    let gapY = 0, bx = Infinity;
    for (const gt of g.gates) if (gt.x > -0.7 && gt.x < bx) { bx = gt.x; gapY = gt.gapY; }
    if (g.y < gapY - 0.05 && g.vy < 0.8) flap();
    p.tick(1);
  }
  for (; s < 14000 && p.state() === 'playing'; s++) p.tick(1);
  return { scored: p.score(), gameOver: p.state() === 'gameover' };
});
const bestBefore = await page.evaluate(() => window.polycade.best('updraft'));
await page.reload();
await page.waitForFunction(() => !!window.polycade);
const bestAfter = await page.evaluate(() => window.polycade.best('updraft'));

await browser.close();
const ok = cards === 5 && result.scored > 0 && result.gameOver && bestAfter === bestBefore && bestAfter > 0;
console.log(JSON.stringify({ base: BASE, cards, ...result, bestBefore, bestAfter, PASS: ok }, null, 2));
process.exit(ok ? 0 : 1);
