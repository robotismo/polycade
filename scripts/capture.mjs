// Capture home + per-game screenshots into docs/ for the README.
// Usage: node scripts/capture.mjs   (expects the dev server on :5173)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = 'docs';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

async function waitApi() {
  await page.waitForFunction(() => !!window.polycade, undefined, { timeout: 20000 });
}

// Home screen.
await page.goto(`${BASE}/#/`);
await waitApi();
await sleep(400);
await page.screenshot({ path: `${OUT}/home.png` });
console.log('saved home.png');

// Per-game: start, play briefly with light real input so the scene is lively.
const KEYS = {
  updraft: ['Space', 'Space', 'Space', 'Space'],
  coil: ['ArrowUp', 'ArrowRight'],
  shatter: ['Space', 'ArrowRight'],
  rally: ['ArrowRight', 'ArrowLeft'],
  driftfield: ['ArrowLeft', 'Space', 'ArrowUp', 'Space'],
};

for (const id of Object.keys(KEYS)) {
  await page.goto(`${BASE}/#/play/${id}`);
  await waitApi();
  await page.waitForFunction((g) => window.polycade.currentId() === g && window.polycade.state() === 'ready', id);
  await page.evaluate(() => window.polycade.start());
  // Sprinkle a few real key presses while the render loop runs.
  for (const k of KEYS[id]) {
    await page.keyboard.press(k);
    await sleep(180);
  }
  await sleep(450);
  await page.screenshot({ path: `${OUT}/${id}.png` });
  console.log(`saved ${id}.png`);
}

await browser.close();
console.log('done');
