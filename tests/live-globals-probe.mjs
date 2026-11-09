// Debug: find a way to call the Host's workspace unarchive RPC from the page.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

function loadPlaywright() {
  for (const spec of [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    // Set PLAYWRIGHT_PATH if playwright is not resolvable from this repo.
  ].filter(Boolean)) {
    try {
      const req = createRequire(import.meta.url);
      if (!existsSync(req.resolve(spec))) continue;
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
await page.waitForTimeout(3000);

const keys = await page.evaluate(() =>
  Object.keys(globalThis).filter((k) => /dsh|cordis|slot|remote|ctx/i.test(k)).sort(),
);
console.log('globals:', JSON.stringify(keys));

for (const k of keys) {
  const shape = await page.evaluate((key) => {
    const v = globalThis[key];
    if (v === null || typeof v !== 'object') return typeof v;
    return Object.keys(v).slice(0, 25);
  }, k);
  console.log('  ' + k + ' -> ' + JSON.stringify(shape));
}

await browser.close();
