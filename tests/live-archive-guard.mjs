// LIVE end-to-end verification of the archived-session guard, against the
// REAL running DSH web GUI (http://127.0.0.1:3080).
//
// It reproduces the user's report verbatim, in the real product:
//   1. open a session that has an assistant message in the workspace sidebar
//   2. click the plugin's real "read aloud" button on that message
//      (the real <audio> element really plays)
//   3. click the sidebar's real "archive session" action for that session
//   4. assert the read STOPPED, the audio PAUSED, and the guard logged it
//
// Nothing here is mocked: the guard's state comes from the Host's own
// workspace archive set, pushed over the real workspace stream.
//
//   node tests/live-archive-guard.mjs <token> [baseUrl]
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
    } catch (e) { /* try the next candidate */ }
  }
  throw new Error('playwright not found — set PLAYWRIGHT_PATH');
}
const { chromium } = loadPlaywright();

const token = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:3080';
if (!token) {
  console.error('usage: node tests/live-archive-guard.mjs <token> [baseUrl]');
  process.exit(2);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleLines = [];
page.on('console', (m) => consoleLines.push(m.text()));
page.on('pageerror', (e) => consoleLines.push('pageerror: ' + e.message));

try {
  await page.goto(`${base}/?token=${encodeURIComponent(token)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(
    () => typeof window.__dshTtsArchive === 'object' && window.__dshTtsArchive !== null,
    { timeout: 60000 },
  );
  check('plugin client bundle loaded (guard hook present)', true);
  await page.waitForTimeout(3000);

  // --- 1. find a session row that has a read-aloud button ---------------
  // The plugin's read-aloud button lives in the assistant-actions strip of a
  // message. Open the first session that shows one.
  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-row-key^="session:"]')];
    return rows.map((r) => r.getAttribute('data-row-key').slice('session:'.length));
  });
  check('sidebar lists session rows', opened.length > 0, 'rows=' + opened.length);

  let target = null;
  for (const sessionId of opened) {
    // Open the session by clicking its row title button.
    const rowHandle = page.locator(`[data-row-key="session:${sessionId}"]`).first();
    if (await rowHandle.count() === 0) continue;
    await rowHandle.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const readBtn = page.locator('button.dsh-tts-action:not(.dsh-tts-action-dl)').first();
    if (await readBtn.count() > 0) {
      const disabled = await readBtn.isDisabled().catch(() => true);
      if (!disabled) { target = { sessionId, readBtn }; break; }
    }
  }
  check('a session with a usable read-aloud button was found', !!target,
    target ? 'session=' + target.sessionId : 'none');
  if (!target) throw new Error('no session with a read-aloud button');

  // --- 2. start the read (the REAL button, the REAL <audio>) -----------
  await target.readBtn.click();
  // Wait until the plugin reports it is speaking for that session.
  const started = await page.waitForFunction(
    (sid) => {
      const A = window.__dshTtsArchive;
      return A && A.speaking() === true && A.readSessionId() === sid;
    },
    target.sessionId,
    { timeout: 30000 },
  ).then(() => true).catch(() => false);
  check('read started and is bound to the session', started);

  // The synthesis round-trip takes a moment; wait until the real <audio>
  // element actually carries our audio URL and starts playing.
  const audioReady = await page.waitForFunction(() => {
    const els = [...document.querySelectorAll('audio')];
    const ours = els.filter((a) => (a.currentSrc || a.getAttribute('src') || '').indexOf('/dsh-tts-audio/') >= 0);
    return ours.length > 0 && ours.some((a) => !a.paused && !a.ended);
  }, undefined, { timeout: 30000 }).then(() => true).catch(() => false);

  const audioState = await page.evaluate(() => {
    const els = [...document.querySelectorAll('audio')];
    const ours = els.filter((a) => (a.currentSrc || a.getAttribute('src') || '').indexOf('/dsh-tts-audio/') >= 0);
    return {
      count: els.length,
      withSrc: ours.length,
      playing: ours.filter((a) => !a.paused && !a.ended).length,
      src: ours.map((a) => a.currentSrc || a.getAttribute('src')).slice(0, 2),
    };
  });
  check('a real <audio> element is playing the synthesized audio',
    audioReady && audioState.playing > 0, JSON.stringify(audioState));

  // --- 3. archive the session through the REAL sidebar action ----------
  // The archive button is a HOVER action: reveal it by hovering the row.
  const row = page.locator(`[data-row-key="session:${target.sessionId}"]`).first();
  await row.hover().catch(() => {});
  await page.waitForTimeout(600);
  const archiveBtn = page
    .locator(`[data-row-key="session:${target.sessionId}"] button[aria-label="归档会话"], ` +
             `[data-row-key="session:${target.sessionId}"] button[aria-label="Archive session"]`)
    .first();
  const hasArchiveBtn = await archiveBtn.count() > 0;
  check('sidebar exposes the archive action for that session', hasArchiveBtn);
  if (hasArchiveBtn) {
    await archiveBtn.click({ force: true, timeout: 15000 });
    // The Host asks for confirmation when the session is busy; accept it.
    await page.waitForTimeout(1500);
    for (const label of ['归档', 'Archive', '确认']) {
      const btn = page.getByRole('button', { name: new RegExp(label) }).last();
      if (await btn.count() > 0) { await btn.click({ force: true }).catch(() => {}); break; }
    }
  }

  // --- 4. the read must STOP -------------------------------------------
  const stopped = await page.waitForFunction(
    () => {
      const A = window.__dshTtsArchive;
      return A && A.speaking() === false;
    },
    undefined,
    { timeout: 30000 },
  ).then(() => true).catch(() => false);
  check('archiving the read session STOPPED the read', stopped);

  const finalState = await page.evaluate((sid) => {
    const A = window.__dshTtsArchive;
    const els = [...document.querySelectorAll('audio')];
    const ours = els.filter((a) => (a.currentSrc || a.getAttribute('src') || '').indexOf('/dsh-tts-audio/') >= 0);
    return {
      speaking: A.speaking(),
      readSessionId: A.readSessionId(),
      archived: A.archived(),
      isArchived: A.isArchived(sid),
      canRead: A.canRead(sid),
      audioPlaying: ours.filter((a) => !a.paused && !a.ended).length,
      audioWithSrc: ours.length,
    };
  }, target.sessionId);

  check('guard reports the session as archived', finalState.isArchived === true,
    'archived=' + JSON.stringify(finalState.archived));
  check('the read is no longer speaking', finalState.speaking === false);
  check('the read session binding was cleared', finalState.readSessionId === null,
    'readSessionId=' + finalState.readSessionId);
  check('the audio element is paused (no sound left)', finalState.audioPlaying === 0,
    'playing=' + finalState.audioPlaying + ' withSrc=' + finalState.audioWithSrc);
  check('an archived session refuses a NEW read', finalState.canRead === false);

  const tts = consoleLines.filter((l) => l.includes('[tts]'));
  check('the plugin logged the archive stop',
    tts.some((l) => l.includes('read stopped: session archived')),
    tts.filter((l) => l.includes('read stopped')).join(' | ') || 'no stop log');
  check('the plugin build tag is the archive-guard build',
    tts.some((l) => l.includes('stop-read-on-archived-session')));
} catch (err) {
  check('live scenario ran without throwing', false, String((err && err.message) || err));
} finally {
  if (process.env.LIVE_KEEP_OPEN) {
    console.log('\n(browser left open for inspection)');
  } else {
    await browser.close();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live archive-guard checks passed`);
if (failed.length) {
  console.log('\n--- browser console (last 40) ---');
  for (const l of consoleLines.slice(-40)) console.log('  ' + l);
}
process.exit(failed.length === 0 ? 0 : 1);
