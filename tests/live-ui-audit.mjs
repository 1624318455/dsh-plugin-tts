// Live UI audit: reads back what the running shell actually painted, so the
// design-language work is checked against the real DOM instead of a screenshot.
//
//   node tests/live-ui-audit.mjs [base] [token]
//
// If no token is given, the script mints a short-lived browser-session cookie
// from the LOCAL signing secret in ~/.dsh/.credentials.yaml using dsh's own
// scheme (dsh-client-connection/lib/index.js). The launch token is random per
// process and lives only in a WeakMap, so reproducing the *cookie* is the only
// way to audit an already-running server without restarting it or asking the
// user to copy a URL. The secret never leaves this process and is never logged.
//
// Two things this catches that a unit test cannot:
//   1. stylesheet truncation — the injected <style> must carry the whole sheet
//      (a stray quote inside `content:""` silently drops every later rule)
//   2. baseline drift — inputs, pickers and buttons in one row must share a
//      height, and a picker on a settings row must be the shell's filled 36px
//      PermissionRow selector, not a transparent composer seat or a field box
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

function loadPlaywright() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const mcp = path.join(home, '.npm-global', 'node_modules', '@playwright', 'mcp', 'node_modules');
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    'playwright-core',
    // The npm-global @playwright/mcp install is not resolvable from this repo,
    // but ships a perfectly good playwright-core. Fall back to it explicitly so
    // the audit does not depend on whichever shell environment launched it.
    path.join(mcp, 'playwright'),
    path.join(mcp, 'playwright-core'),
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

const b64u = buf => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');

// Mirror BrowserAuth.encodeCookie / cookieName from dsh-client-connection.
function localSessionCookie(origin) {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const yaml = readFileSync(path.join(home, '.credentials.yaml'), 'utf8');
  const records = yaml.split(/^records:\s*$/m)[1] || '';
  const block = records.split(/client-connection\/browser-session:/)[1];
  const m = block && /^\s*secret:\s*["']?([A-Za-z0-9_-]+)["']?/m.exec(block);
  if (!m) throw new Error('browser-session signing secret not found in .credentials.yaml');
  const secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64');
  const authority = new URL(origin).host;
  const name = 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest());
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 3600_000; // 1h, safely under any configured maxAgeDays
  const body = b64u(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }));
  const value = `v1.${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`;
  return { name, value, url: origin, expires: expiresAt / 1000, httpOnly: true, sameSite: 'Strict' };
}

const base = process.argv[2] || 'http://127.0.0.1:3080';
const token = process.argv[3];

const browser = await chromium.launch({
  headless: true,
  args: ['--no-proxy-server'],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
if (!token) await context.addCookies([localSessionCookie(base)]);
const page = await context.newPage();
await page.goto(token ? `${base}/?token=${encodeURIComponent(token)}` : `${base}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => typeof window.__dshTtsArchive === 'object' && window.__dshTtsArchive !== null, { timeout: 45000 });
await page.waitForTimeout(2500);

// ---- 1. the stylesheet ----
const sheet = await page.evaluate(() => {
  const tags = [...document.querySelectorAll('style[data-plugin-css="dsh-plugin-tts"]')];
  const css = tags.map(t => t.textContent || '').join('');
  return {
    tags: tags.length,
    len: css.length,
    open: (css.match(/\{/g) || []).length,
    close: (css.match(/\}/g) || []).length,
    tail: css.slice(-80),
    hasTrigger: css.includes('.dsh-tts-dd-trigger{'),
    hasPathRule: css.includes('.dsh-tts-path .dsh-tts-browse{'),
  };
});
console.log('--- stylesheet ---');
console.log(JSON.stringify(sheet, null, 2));

// ---- 2. open the panel: Settings > 内置插件 > 语音 ----
// The panel is registered on the settings.plugins.tab slot, so the shell puts
// it under its own "Voice" tab rather than the plugin inventory list.
await page.getByText('设置', { exact: true }).first().click();
await page.waitForTimeout(350);
await page.getByText('内置插件', { exact: true }).last().click();
await page.waitForTimeout(550);
await page.getByText('语音', { exact: true }).first().click();
await page.waitForFunction(() => document.querySelectorAll('.dsh-tts-module').length > 0, { timeout: 20000 });
await page.waitForTimeout(600);

const results = [];
const num = v => parseFloat(v) || 0;
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

check('stylesheet injected once, whole, brace-balanced',
  sheet.tags === 1 && sheet.len > 20000 && sheet.open === sheet.close && sheet.hasTrigger && sheet.hasPathRule,
  `len=${sheet.len} {=${sheet.open} }=${sheet.close}`);

// ---- 3. measured boxes ----
const boxes = await page.evaluate(() => {
  const cs = el => getComputedStyle(el);
  const num = v => parseFloat(v) || 0;
  const box = el => {
    const r = el.getBoundingClientRect(), s = cs(el);
    return {
      text: (el.textContent || '').trim().slice(0, 28),
      w: Math.round(r.width), h: Math.round(r.height * 10) / 10,
      top: Math.round(r.top), right: Math.round(r.right),
      pad: s.paddingTop + '/' + s.paddingBottom,
      border: s.borderTopWidth, radius: s.borderTopLeftRadius,
      bg: s.backgroundColor, color: s.color,
      font: s.fontSize + '/' + s.fontWeight,
      gap: s.gap, boxSizing: s.boxSizing, corner: s.cornerShape || '',
    };
  };
  const triggers = [...document.querySelectorAll('.dsh-tts-dd-trigger')];
  const classify = el => (el.closest('.dsh-tts-rvc-row') || el.closest('.dsh-tts-path')) ? 'field' : 'selector';
  return {
    selectors: triggers.filter(el => classify(el) === 'selector').map(box),
    fields: triggers.filter(el => classify(el) === 'field').map(box),
    rows: [...document.querySelectorAll('.dsh-tts-module')].slice(0, 6).map(el => {
      const s = cs(el);
      return { pad: s.paddingTop + '/' + s.paddingBottom, border: s.borderBottomWidth, gap: s.columnGap,
        stack: el.classList.contains('dsh-tts-module-stack'), direction: s.flexDirection };
    }),
    paths: [...document.querySelectorAll('.dsh-tts-path')].map(el => ({
      children: [...el.children].map(c => ({ cls: String(c.className).slice(0, 34), h: Math.round(c.getBoundingClientRect().height * 10) / 10 })),
    })),
    inputs: [...document.querySelectorAll('.dsh-tts-rvc-input')].slice(0, 5).map(el => ({ h: Math.round(el.getBoundingClientRect().height), radius: cs(el).borderTopLeftRadius, border: cs(el).borderTopWidth })),
    buttons: [...document.querySelectorAll('.dsh-tts-browse')].slice(0, 8).map(el => ({
      h: Math.round(el.getBoundingClientRect().height), inPath: !!el.closest('.dsh-tts-path'),
    })),
    switches: [...document.querySelectorAll('.dsh-tts-switch')].slice(0, 4).map(box),
    sliderLabels: [...document.querySelectorAll('.dsh-tts-rvc-row:has(.dsh-tts-slider) > .dsh-tts-rvc-label')].slice(0, 3).map(el => ({ text: (el.textContent || '').trim(), font: cs(el).fontSize + '/' + cs(el).fontWeight })),
    rules: (() => {
      const wanted = ['.dsh-tts-module', '.dsh-tts-dd-trigger', '.dsh-tts-rvc-input', '.dsh-tts-rvc-row .dsh-tts-dd-trigger'];
      const all = [];
      for (const s of document.styleSheets) { try { all.push(...s.cssRules); } catch (e) { /* cross-origin */ } }
      return wanted.map(sel => {
        const r = all.find(x => x.selectorText === sel);
        // Shorthands containing var() are NOT expanded into border-*-width by
        // CSSOM, so read the raw declaration instead of asking for a longhand.
        return { sel, raw: r ? r.style.cssText : '', height: r ? r.style.height : null };
      });
    })(),
    overlayIdle: [...document.querySelectorAll('[class*="overlayLayer"]')].map(el => cs(el).zIndex),
    dialogZ: [...document.querySelectorAll('[role="dialog"]')].map(el => cs(el).zIndex),
    dpr: devicePixelRatio,
  };
});
console.log('--- measured boxes (Edge provider) ---');
console.log(JSON.stringify(boxes, null, 2));

// PermissionRow.module.css .oY77xG_selector: 36px / radius-md / no border /
// default --dsw-alias-bg-module-platform fill (rgb(249,250,251) in light
// theme) / 14px-400 primary ink / 12px gap / padding 0 14px. The composer's
// transparent 28px .iWlSmW_trigger is a DIFFERENT control and must not appear
// on a settings row — check the computed background, not just the geometry.
const filled = s => /^rgb\(/.test(s.bg) && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.bg);
const selectorsOk = boxes.selectors.length > 0 && boxes.selectors.every(s =>
  s.h === 36 && num(s.border) === 0 && num(s.radius) === 12 &&
  num(s.font) === 14 && /\/400$/.test(s.font) && s.gap === '12px' &&
  s.pad === '0px/0px' && filled(s));
check('settings-row pickers are filled 36px PermissionRow selectors', selectorsOk,
  boxes.selectors.map(s => `${s.text}:${s.h}px/${s.bg}/${s.radius}/${s.font}/gap:${s.gap}`).join(' '));

// PermissionRow's PopupSelect is opened with align:"end". Open a real picker
// and verify its surface grows left from the trigger's right edge instead of
// spilling past the settings dialog (long option labels used to overflow).
await page.locator('.dsh-tts-module > .dsh-tts-dd .dsh-tts-dd-trigger').first().click();
await page.waitForTimeout(250);
const align = await page.evaluate(() => {
  const trig = document.querySelector('.dsh-tts-module > .dsh-tts-dd .dsh-tts-dd-trigger');
  const menu = trig && trig.parentElement.querySelector('.dsh-tts-dd-menu');
  const dialog = document.querySelector('[role="dialog"]');
  if (!trig || !menu || !dialog) return null;
  const t = trig.getBoundingClientRect(), m = menu.getBoundingClientRect(), d = dialog.getBoundingClientRect();
  return { trigRight: Math.round(t.right), menuRight: Math.round(m.right), menuLeft: Math.round(m.left), dialogRight: Math.round(d.right) };
});
check('settings-row menu is end-aligned and stays inside the dialog',
  !!align && Math.abs(align.menuRight - align.trigRight) <= 2 && align.menuRight <= align.dialogRight + 1,
  JSON.stringify(align));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// Hairline borders are authored as 0.5px (the shell's own value) but Chrome
// rounds the *computed* value to 1px at DPR 1 — the shell's rows measure 1px
// here too. Assert the authored value from the CSSOM and only bound the
// computed value, otherwise this reds on every non-retina display.
const authored = sel => (boxes.rules.find(r => r.sel === sel) || {}).raw || '';
// A .dsh-tts-module-stack is a vertical group container, not a settings row:
// the shell's settings pages use gap:10px there (12 occurrences across the
// settings packages), so only plain rows get the 24px two-column rhythm.
const plainRows = boxes.rows.filter(r => !r.stack);
const stacks = boxes.rows.filter(r => r.stack);
check('settings rows use the shell rhythm', plainRows.length > 0 && plainRows.every(r =>
  r.pad === '16px/16px' && num(r.border) <= 1 && r.gap === '24px' && r.direction === 'row') &&
  stacks.every(r => r.gap === '10px' && r.direction === 'column') &&
  /border-bottom:\s*0\.5px/.test(authored('.dsh-tts-module')) &&
  /border:\s*0\.5px/.test(authored('.dsh-tts-rvc-input')),
  `rows=${plainRows.length} stacks=${stacks.length} | authored hairline DPR=${boxes.dpr}`);

check('standalone buttons are Button.sm (28px)', boxes.buttons.filter(b => !b.inPath).every(b => b.h === 28),
  `${boxes.buttons.filter(b => !b.inPath).length} standalone`);

check('switches are 36x20 border-box round capsules', boxes.switches.length > 0 && boxes.switches.every(s =>
  s.w === 36 && s.h === 20 && s.boxSizing === 'border-box' && /round/.test(s.corner)),
  `${boxes.switches.length} switches`);

// ---- 3b. switch to the RVC provider so the path rows actually render ----
// On the Edge panel there are no .dsh-tts-path rows at all; asserting on that
// empty set would "pass" without ever exercising the rule we just fixed.
await page.getByText('Edge TTS', { exact: true }).first().click();
await page.waitForTimeout(300);
await page.getByText('自定义音色（RVC）', { exact: true }).first().click();
await page.waitForFunction(() => document.querySelectorAll('.dsh-tts-path').length > 0, { timeout: 15000 });
await page.waitForTimeout(450);
const fieldBoxes = await page.evaluate(() => {
  const cs = el => getComputedStyle(el);
  const h = el => Math.round(el.getBoundingClientRect().height * 10) / 10;
  return {
    paths: [...document.querySelectorAll('.dsh-tts-path')].map(el => [...el.children].map(c => ({
      cls: String(c.className).slice(0, 30), h: h(c), radius: cs(c).borderTopLeftRadius,
    }))),
    inputs: [...document.querySelectorAll('.dsh-tts-rvc-input')].map(el => ({ h: h(el), radius: cs(el).borderTopLeftRadius })),
    fields: [...document.querySelectorAll('.dsh-tts-dd-trigger')]
      .filter(el => el.closest('.dsh-tts-rvc-row') || el.closest('.dsh-tts-path'))
      .map(el => ({ h: h(el), radius: cs(el).borderTopLeftRadius, border: cs(el).borderTopWidth })),
    buttons: [...document.querySelectorAll('.dsh-tts-browse')].map(el => ({
      h: h(el), inPath: !!el.closest('.dsh-tts-path'), radius: cs(el).borderTopLeftRadius,
    })),
    // A note's left edge must line up with the control above it. It used to be
    // indented by the 110px label width only, ignoring the row's 10px gap.
    notes: [...document.querySelectorAll('.dsh-tts-field > .dsh-tts-note')]
      .filter(el => !el.parentElement.querySelector('.dsh-tts-slider'))
      .map(el => {
        const row = el.parentElement.querySelector('.dsh-tts-rvc-row');
        const control = row && row.children[1];
        return control ? {
          text: (el.textContent || '').trim().slice(0, 22),
          delta: Math.round((el.getBoundingClientRect().left - control.getBoundingClientRect().left) * 10) / 10,
        } : null;
      }).filter(Boolean),
  };
});
console.log('--- measured boxes (RVC provider) ---');
console.log(JSON.stringify(fieldBoxes, null, 2));

check('path rows are present and share one 32px baseline', fieldBoxes.paths.length > 0 && fieldBoxes.paths.every(p =>
  p.length > 0 && p.every(c => Math.abs(c.h - 32) < 1.1 && num(c.radius) === 12)),
  `${fieldBoxes.paths.length} rows: ${fieldBoxes.paths.map(p => p.map(c => c.h).join('/')).join(' , ')}`);

check('path buttons adopt the field box', fieldBoxes.buttons.filter(b => b.inPath).length > 0 &&
  fieldBoxes.buttons.filter(b => b.inPath).every(b => b.h === 32 && num(b.radius) === 12) &&
  fieldBoxes.buttons.filter(b => !b.inPath).every(b => b.h === 28),
  `inPath=${fieldBoxes.buttons.filter(b => b.inPath).length} standalone=${fieldBoxes.buttons.filter(b => !b.inPath).length}`);

check('field pickers and inputs share the 32px / radius-md box', fieldBoxes.fields.length > 0 &&
  fieldBoxes.fields.every(f => f.h === 32 && num(f.radius) === 12 && num(f.border) <= 1) &&
  fieldBoxes.inputs.length > 0 && fieldBoxes.inputs.every(i => i.h === 32 && num(i.radius) === 12),
  `fields=${fieldBoxes.fields.length} inputs=${fieldBoxes.inputs.length}`);

check('field notes line up with their control column', fieldBoxes.notes.length > 0 &&
  fieldBoxes.notes.every(n => Math.abs(n.delta) <= 1.5),
  `${fieldBoxes.notes.length} notes: delta=${fieldBoxes.notes.map(n => n.delta).join(',')}`);

// ---- 4. toast layering inside the settings dialog ----
await page.evaluate(() => window.__dshTtsToast.show('设计语言审计 · toast 层级检查', 'ok'));
await page.waitForTimeout(350);
const toast = await page.evaluate(() => {
  const el = document.querySelector('.dsh-tts-toast');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    text: (el.textContent || '').trim().slice(0, 40),
    rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) },
    z: s.zIndex, radius: s.borderRadius, bg: s.backgroundColor, border: s.borderTopWidth,
    hit: hit ? String(hit.className).slice(0, 50) : null,
    hitIsToast: !!(hit && hit.closest && hit.closest('.dsh-tts-toast')),
    overlayZ: [...document.querySelectorAll('[class*="overlayLayer"]')].map(e => getComputedStyle(e).zIndex),
    viewport: { w: innerWidth, h: innerHeight },
  };
});
console.log('--- toast ---');
console.log(JSON.stringify(toast, null, 2));
check('toast is painted above the settings dialog and hit-testable', !!toast && toast.hitIsToast
  && Number(toast.overlayZ[0]) >= 1000 && toast.rect.top >= 0 && toast.rect.bottom <= toast.viewport.h,
  toast ? `overlayZ=${toast.overlayZ} hit=${toast.hit}` : 'toast not rendered');
check('toast uses the shell dark surface', !!toast && num(toast.border) === 0 && num(toast.radius) === 16,
  toast ? `radius=${toast.radius} border=${toast.border} bg=${toast.bg}` : '');

if (process.env.AUDIT_SHOT) {
  await page.screenshot({ path: process.env.AUDIT_SHOT });
  console.log('screenshot: ' + process.env.AUDIT_SHOT);
}
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} live UI checks passed`);
process.exit(failed === 0 ? 0 : 1);
