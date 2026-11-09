// Un-archive sessions through the Host's workspace RPC endpoint.
//
// The sidebar's "unarchive" row action is only reachable behind the
// "view options" menu; this helper calls the Host directly so a test run
// can always put the workspace back the way it found it.
//
//   node tests/live-unarchive.mjs <token> <sessionId> [baseUrl]
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
const rest = process.argv.slice(3);
const base = rest.length > 0 && rest[rest.length - 1].startsWith('http') ? rest.pop() : 'http://127.0.0.1:3080';
const sessionIds = rest;
if (!token || sessionIds.length === 0) {
  console.error('usage: node tests/live-unarchive.mjs <token> <sessionId...> [baseUrl]');
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
try {
  // The token exchange sets the auth cookie, so plain fetches are allowed.
  await page.goto(`${base}/?token=${encodeURIComponent(token)}`, {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  await page.waitForFunction(
    () => typeof window.__dshTtsArchive === 'object' && window.__dshTtsArchive !== null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2000);

  for (const sessionId of sessionIds) {
    const out = await page.evaluate(async (sid) => {
      const rpcId = 'unarchive-' + Math.random().toString(36).slice(2);
      let res;
      try {
        res = await fetch('/api/workspace/unarchiveSession', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId,
            method: 'workspace/unarchiveSession',
            payload: { sessionId: sid },
          }),
        });
      } catch (e) {
        return { ok: false, error: String(e) };
      }
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
    }, sessionId);
    console.log(`${sessionId}: HTTP ${out.status} ${out.ok ? 'OK' : 'ERR'} ${out.body || out.error || ''}`);
  }

  // Let the pushed archive set reach the client, then report the result.
  await page.waitForTimeout(2500);
  const state = await page.evaluate((sids) => ({
    archived: window.__dshTtsArchive.archived(),
    stillArchived: sids.filter((s) => window.__dshTtsArchive.isArchived(s)),
    canRead: sids.map((s) => window.__dshTtsArchive.canRead(s)),
  }), sessionIds);
  console.log('still archived:', JSON.stringify(state.stillArchived));
  console.log('canRead      :', JSON.stringify(state.canRead));
  console.log(state.stillArchived.length === 0 ? 'RESTORED' : 'NOT RESTORED');
} finally {
  await browser.close();
}
