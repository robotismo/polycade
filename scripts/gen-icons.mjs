// Generate PNG PWA icons + an OG social card from the SVG / live home screen.
// Usage: node scripts/gen-icons.mjs   (expects the dev server on :5173)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function renderIcon(size, out, { padding = 0 } = {}) {
  const page = await browser.newContext({ deviceScaleFactor: 1 }).then((c) => c.newPage());
  const inner = size - padding * 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:#08080f;width:${size}px;height:${size}px">
       <div style="position:absolute;left:${padding}px;top:${padding}px;width:${inner}px;height:${inner}px">${svg}</div>
     </body>`,
  );
  const el = await page.$('svg');
  await el.evaluate((s, n) => {
    s.setAttribute('width', n);
    s.setAttribute('height', n);
  }, inner);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log('saved', out);
}

await renderIcon(192, 'public/icon-192.png');
await renderIcon(512, 'public/icon-512.png');
await renderIcon(512, 'public/icon-maskable.png', { padding: 64 }); // ~12.5% safe-zone padding
await renderIcon(180, 'public/apple-touch-icon.png');

// OG social card: the live home screen at 1200x630.
const og = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 }).then((c) => c.newPage());
await og.goto(`${BASE}/#/`);
await og.waitForFunction(() => !!window.polycade, undefined, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 500));
await og.screenshot({ path: 'public/og.png' });
console.log('saved public/og.png');

await browser.close();
