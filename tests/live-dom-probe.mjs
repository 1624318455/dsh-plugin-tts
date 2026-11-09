// DOM probe: dump the sidebar structure so the live test can use the REAL
// selectors (the workspace session rows and their archive action).
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    // Set PLAYWRIGHT_PATH if playwright is not resolvable from this repo.
  ].filter(Boolean);
  for (const spec of candidates) {
    try {
      const req = createRequire(import.meta.url);
      const resolved = req.resolve(spec);
      if (!existsSync(resolved)) continue;
      return req(spec);
    } catch (e) { /* next */ }
  }
  throw new Error('playwright not found');
}
const { chromium } = loadPlaywright();

const token = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:3080';

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`${base}/?token=${encodeURIComponent(token)}`, {
  waitUntil: 'domcontentloaded', timeout: 60000,
});
await page.waitForFunction(
  () => typeof window.__dshTtsArchive === 'object' && window.__dshTtsArchive !== null,
  { timeout: 60000 },
);
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const attrNames = new Map();
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (!a.name.startsWith('data-')) continue;
      if (!attrNames.has(a.name)) attrNames.set(a.name, []);
      const v = a.value;
      if (attrNames.get(a.name).length < 4) attrNames.get(a.name).push(v.slice(0, 60));
    }
  }
  const buttons = [...document.querySelectorAll('button')].map((b) => ({
    aria: b.getAttribute('aria-label'),
    title: b.getAttribute('data-tts-tip'),
    cls: (b.className || '').toString().slice(0, 60),
  })).filter((b) => b.aria || b.title);
  return {
    dataAttrs: [...attrNames.entries()].map(([k, v]) => k + ' = ' + JSON.stringify(v)),
    buttons: buttons.slice(0, 60),
    bodyText: document.body.innerText.slice(0, 1500),
  };
});
console.log('=== DATA ATTRS ===');
for (const d of info.dataAttrs) console.log('  ' + d);
console.log('\n=== BUTTONS (with aria/title) ===');
for (const b of info.buttons) console.log('  ' + JSON.stringify(b));
console.log('\n=== BODY TEXT ===');
console.log(info.bodyText);

await page.screenshot({ path: 'tests/live-sidebar.png', fullPage: false }); // relative to repo root; gitignored
await browser.close();
