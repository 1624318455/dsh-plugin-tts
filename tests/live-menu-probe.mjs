// Debug: open the view options menu and report exactly what appears.
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

const vo = page.locator('button[aria-label="视图选项"]').first();
console.log('viewOptions count:', await vo.count());
console.log('visible:', await vo.isVisible().catch(() => false));
await vo.click({ force: true });
await page.waitForTimeout(2000);

const items = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[role="menuitem"], [role="option"], [role="menu"] *')) {
    const text = (el.innerText || el.textContent || '').trim();
    if (!text || text.length > 40) continue;
    out.push({ role: el.getAttribute('role'), text, cls: (el.className || '').toString().slice(0, 40) });
  }
  // de-dup
  const seen = new Set();
  return out.filter((o) => { const k = o.role + '|' + o.text; if (seen.has(k)) return false; seen.add(k); });
});
console.log('--- menu items ---');
for (const i of items) console.log('  ' + JSON.stringify(i));

await page.screenshot({ path: 'tests/live-menu.png' }); // relative to repo root; gitignored
await browser.close();
