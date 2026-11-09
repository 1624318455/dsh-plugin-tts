// Live UI audit: reads back what the running shell actually painted, so the
// design-language work is checked against the real DOM instead of a screenshot.
//
//   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//     node tests/live-ui-audit.mjs [base] [token]
//
// If Playwright's own browser download is missing/outdated, the script falls
// back to an installed Chrome or Edge so a machine update cannot silently
// disable the audit.
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

const launchOptions = {
  headless: true,
  args: ['--no-proxy-server'],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
};
function systemBrowser() {
  const roots = [process.env.LOCALAPPDATA, 'C:/Program Files', 'C:/Program Files (x86)'].filter(Boolean);
  const rels = [
    'Google/Chrome/Application/chrome.exe',
    'Microsoft/Edge/Application/msedge.exe',
  ];
  for (const root of roots) for (const rel of rels) {
    const p = path.join(root, rel);
    if (existsSync(p)) return p;
  }
  return null;
}
let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (e) {
  const exe = systemBrowser();
  if (!exe) throw e;
  console.log(`playwright browser unavailable (${e.message.split('\n')[0]}); using ${exe}`);
  browser = await chromium.launch({ ...launchOptions, executablePath: exe });
}
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
      const wanted = ['.dsh-tts-module', '.dsh-tts-dd-trigger', '.dsh-tts-rvc-input', '.dsh-tts-rvc-row .dsh-tts-dd-trigger', '.dsh-tts-switch', '.dsh-tts-switch-thumb'];
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
    // Chrome serialises `corner-shape:round` as `superellipse(1)` in
    // getComputedStyle (newer builds) while older builds return the literal
    // `round`. Probe a known-round element instead of hard-coding either form.
    probeRound: (() => {
      const el = document.createElement('div');
      el.style.cornerShape = 'round';
      document.body.appendChild(el);
      const v = getComputedStyle(el).cornerShape;
      el.remove();
      return v;
    })(),
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
  JSON.stringify(align && { trigRight: align.trigRight, menuRight: align.menuRight, dialogRight: align.dialogRight }));

// The provider list is the product surface: 0.7.0 shipped a generic
// "OpenAI-compatible" entry fronted by a Python gateway. It was replaced by a
// dedicated local GPT-SoVITS provider that speaks api_v2.py's native /tts.
// Assert on the REAL rendered menu, not just the client source — a stale
// profile copy would otherwise keep offering the removed provider. The first
// picker on the panel is the *language* selector, so target the provider
// dropdown by its own class instead of `.first()`.
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
await page.locator('.dsh-tts-dd-provider .dsh-tts-dd-trigger').first().click();
await page.waitForTimeout(250);
const providerItems = await page.evaluate(() => {
  const wrap = document.querySelector('.dsh-tts-dd-provider');
  const menu = wrap && wrap.querySelector('.dsh-tts-dd-menu');
  return menu ? [...menu.querySelectorAll('.dsh-tts-dd-item-text')].map(e => (e.textContent || '').trim()) : [];
});
const EXPECTED_PROVIDERS = ['Edge TTS', 'RVC', 'IndexTTS-2', 'CosyVoice2.0', 'Cloud TTS', 'GPT-SoVITS'];
check('provider menu lists six bare engine names in UI order, no legacy labels or OpenAI entry',
  providerItems.length === 6 &&
  providerItems.every((x, i) => x === EXPECTED_PROVIDERS[i]) &&
  providerItems.every(x => !/[（）()]/.test(x)) &&
  providerItems.every(x => !/OpenAI/i.test(x)),
  providerItems.join(' | ') || 'menu items not found');
const providerHints = await page.evaluate(() => {
  const wrap = document.querySelector('.dsh-tts-dd-provider');
  const menu = wrap && wrap.querySelector('.dsh-tts-dd-menu');
  return menu ? [...menu.querySelectorAll('.dsh-tts-dd-item')].map(e => {
    const hint = e.querySelector('.dsh-tts-dd-item-hint');
    return {
      right: hint ? Math.round(hint.getBoundingClientRect().right * 10) / 10 : null,
      // The selected row carries a 16px checkmark after the hint, so its hint
      // legitimately sits one icon to the left. Compare the plain rows only.
      checked: !!e.querySelector('.dsh-tts-dd-check'),
    };
  }) : [];
});
const plainHints = providerHints.filter(x => !x.checked && x.right !== null);
check('provider hint column stays right-aligned with short labels',
  providerHints.length === 6 && plainHints.length >= 5 &&
  new Set(plainHints.map(x => x.right)).size === 1,
  JSON.stringify(providerHints));
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
  s.w === 36 && s.h === 20 && s.boxSizing === 'border-box' && s.corner === boxes.probeRound) &&
  /corner-shape:\s*round/.test(authored('.dsh-tts-switch')) &&
  /corner-shape:\s*round/.test(authored('.dsh-tts-switch-thumb')),
  `${boxes.switches.length} switches; round=${boxes.probeRound} computed=${[...new Set(boxes.switches.map(s => s.corner))].join(',')}`);

// ---- 3b. switch to the RVC provider so the path rows actually render ----
// On the Edge panel there are no .dsh-tts-path rows at all; asserting on that
// empty set would "pass" without ever exercising the rule we just fixed.
await page.getByText('Edge TTS', { exact: true }).first().click();
await page.waitForTimeout(300);
await page.locator('.dsh-tts-dd-provider .dsh-tts-dd-item-text')
  .filter({ hasText: /^RVC$/ }).first().click();
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
    // Slider rows are on the same grid now, so no field is exempt.
    notes: [...document.querySelectorAll('.dsh-tts-field > .dsh-tts-note')]
      .map(el => {
        const row = el.parentElement.querySelector('.dsh-tts-rvc-row');
        const control = row && row.children[1];
        return control ? {
          text: (el.textContent || '').trim().slice(0, 22),
          delta: Math.round((el.getBoundingClientRect().left - control.getBoundingClientRect().left) * 10) / 10,
        } : null;
      }).filter(Boolean),
    // The provider card has its own border and sits at gap:0 from the row above.
    // Two hairlines on the same pixel read as a broken border. Only that row is
    // suppressed; plain rows must still be separated.
    cardEdges: [...document.querySelectorAll('.dsh-tts-settings > .dsh-tts-module:not(.dsh-tts-rvc)')]
      .filter(el => el.nextElementSibling && el.nextElementSibling.classList.contains('dsh-tts-rvc'))
      .map(el => ({
        title: (el.querySelector('.dsh-tts-module-title')?.textContent || '').trim().slice(0, 20),
        rowBorder: getComputedStyle(el).borderBottomWidth,
        cardBorder: getComputedStyle(el.nextElementSibling).borderTopWidth,
        gap: Math.round(el.nextElementSibling.getBoundingClientRect().top - el.getBoundingClientRect().bottom),
      })),
    // Two provider cards in a row (RVC / Index-TTS2) must keep BOTH strokes and
    // be pulled apart — suppressing the first card's bottom border instead would
    // leave an unclosed card that reads as one box cut by a stray line.
    cardPairs: [...document.querySelectorAll('.dsh-tts-settings > .dsh-tts-rvc')]
      .filter(el => el.previousElementSibling && el.previousElementSibling.classList.contains('dsh-tts-rvc'))
      .map(el => ({
        gap: Math.round(el.getBoundingClientRect().top - el.previousElementSibling.getBoundingClientRect().bottom),
        prevBorder: getComputedStyle(el.previousElementSibling).borderBottomWidth,
        ownBorder: getComputedStyle(el).borderTopWidth,
      })),
    otherRows: [...document.querySelectorAll('.dsh-tts-settings > .dsh-tts-module:not(.dsh-tts-rvc)')]
      .filter(el => el.nextElementSibling && !el.nextElementSibling.classList.contains('dsh-tts-rvc'))
      .map(el => getComputedStyle(el).borderBottomWidth),
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

check('row before a provider card has no doubled hairline', fieldBoxes.cardEdges.length > 0 &&
  fieldBoxes.cardEdges.every(e => num(e.rowBorder) === 0 && num(e.cardBorder) > 0 && e.gap === 0),
  JSON.stringify(fieldBoxes.cardEdges));

check('adjacent provider cards keep both borders and a gap', fieldBoxes.cardPairs.length > 0 &&
  fieldBoxes.cardPairs.every(p => p.gap >= 10 && num(p.prevBorder) > 0 && num(p.ownBorder) > 0),
  JSON.stringify(fieldBoxes.cardPairs));

check('plain rows keep their separators', fieldBoxes.otherRows.length > 0 &&
  fieldBoxes.otherRows.every(b => num(b) > 0),
  `${fieldBoxes.otherRows.length} rows: ${[...new Set(fieldBoxes.otherRows)].join(',')}`);

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

// ---- 5. GPT-SoVITS panel: separated steps / collapsed advanced / sliders ----
// client-load.mjs asserts the source; here we verify what the browser really
// renders after switching to the provider and unfolding both disclosures.
await page.locator('.dsh-tts-dd-provider .dsh-tts-dd-trigger').first().click();
await page.waitForTimeout(250);
await page.locator('.dsh-tts-dd-provider .dsh-tts-dd-item')
  .filter({ hasText: 'GPT-SoVITS' }).first().click();
await page.waitForFunction(() => !!document.querySelector('.dsh-tts-steps'), { timeout: 15000 });
await page.waitForTimeout(350);

await page.locator('.dsh-tts-help > summary').first().click();
await page.waitForTimeout(200);
const gsvClosed = await page.evaluate(() => {
  const adv = document.querySelector('.dsh-tts-advanced');
  const items = [...document.querySelectorAll('.dsh-tts-steps li')];
  const visibleFields = [...document.querySelectorAll('.dsh-tts-field')]
    .filter(el => el.getBoundingClientRect().height > 0);
  const fieldByLabel = kw => visibleFields.find(el =>
    (el.querySelector('.dsh-tts-rvc-label')?.textContent || '').includes(kw));
  const speedRow = fieldByLabel('语速');
  // A slider must sit on the exact same three columns as a dropdown row:
  // right-aligned label edge, control left edge, hint left edge.
  const geom = el => {
    if (!el) return null;
    const row = el.querySelector('.dsh-tts-rvc-row');
    const label = el.querySelector('.dsh-tts-rvc-label');
    const control = row && row.children[1];
    const note = el.querySelector(':scope > .dsh-tts-note');
    const box = x => x ? x.getBoundingClientRect() : null;
    const one = n => Math.round(n * 10) / 10;
    return {
      labelRight: one(box(label).right),
      controlLeft: one(box(control).left),
      noteLeft: note ? one(box(note).left) : null,
      labelFont: getComputedStyle(label).fontSize,
      labelColor: getComputedStyle(label).color,
      rowHeight: one(box(row).height),
      // The track's min / max / value scale stays inside the control column:
      // no overlapping chips and no overflow past the field's right edge.
      scale: (() => {
        const s = el.querySelector('.dsh-tts-slider-scale');
        if (!s) return null;
        const kids = [...s.children].map(c => c.getBoundingClientRect());
        const overlap = kids.some((r, i) => i > 0 && r.left < kids[i - 1].right - 0.5);
        return { overlap, right: one(kids[kids.length - 1].right), boxRight: one(box(control).right) };
      })(),
    };
  };
  return {
    helpOpen: !!document.querySelector('.dsh-tts-help[open]'),
    itemCount: items.length,
    itemTops: items.map(el => Math.round(el.getBoundingClientRect().top)),
    badge: items.length ? getComputedStyle(items[0], '::before').borderTopLeftRadius : null,
    advOpen: adv ? adv.open : null,
    advFields: adv ? adv.querySelectorAll('.dsh-tts-field').length : 0,
    advRanges: adv ? adv.querySelectorAll('input[type=range]').length : 0,
    advNums: adv ? adv.querySelectorAll('input[type=number]').length : 0,
    advSwitches: adv ? adv.querySelectorAll('.dsh-tts-switch').length : 0,
    speedIsRange: !!(speedRow && speedRow.querySelector('input[type=range]')),
    pageRanges: document.querySelectorAll('.dsh-tts-slider input[type=range]').length,
    triggerLabel: (document.querySelector('.dsh-tts-dd-provider .dsh-tts-dd-label')?.textContent || '').trim(),
    formatGeom: geom(fieldByLabel('输出格式')),
    speedGeom: geom(speedRow),
  };
});
check('setup steps are four distinct rows, each on its own line',
  gsvClosed.helpOpen && gsvClosed.itemCount === 4 && new Set(gsvClosed.itemTops).size === 4 &&
  gsvClosed.itemTops.every((t, i) => i === 0 || t > gsvClosed.itemTops[i - 1]),
  JSON.stringify({ count: gsvClosed.itemCount, tops: gsvClosed.itemTops, badge: gsvClosed.badge }));
check('selected provider trigger shows the bare engine name',
  gsvClosed.triggerLabel === 'GPT-SoVITS',
  gsvClosed.triggerLabel);
check('advanced panel is collapsed by default and holds 7 discrete fields',
  gsvClosed.advOpen === false && gsvClosed.advFields === 7 && gsvClosed.advRanges === 5 &&
  gsvClosed.advNums === 1 && gsvClosed.advSwitches === 1,
  JSON.stringify({ open: gsvClosed.advOpen, fields: gsvClosed.advFields, ranges: gsvClosed.advRanges,
    nums: gsvClosed.advNums, switches: gsvClosed.advSwitches }));
check('bounded numeric fields are real sliders in the browser',
  gsvClosed.speedIsRange && gsvClosed.pageRanges >= 6 && gsvClosed.advRanges === 5,
  gsvClosed.pageRanges + ' range inputs on the panel');
const fmtGeom = gsvClosed.formatGeom, spdGeom = gsvClosed.speedGeom;
check('speed slider is a peer row of output format (label / control / hint columns + height)',
  !!fmtGeom && !!spdGeom &&
  Math.abs(fmtGeom.labelRight - spdGeom.labelRight) <= 1 &&
  Math.abs(fmtGeom.controlLeft - spdGeom.controlLeft) <= 1 &&
  Math.abs(fmtGeom.noteLeft - spdGeom.noteLeft) <= 1 &&
  fmtGeom.labelFont === spdGeom.labelFont &&
  fmtGeom.labelColor === spdGeom.labelColor &&
  Math.abs(fmtGeom.rowHeight - spdGeom.rowHeight) <= 2,
  JSON.stringify({ format: fmtGeom, speed: spdGeom }));
check('slider scale stays inside the control column without overlapping chips',
  !!spdGeom && !!spdGeom.scale && !spdGeom.scale.overlap &&
  spdGeom.scale.right <= spdGeom.scale.boxRight + 1,
  JSON.stringify(spdGeom && spdGeom.scale));
await page.locator('.dsh-tts-advanced > summary').first().click();
await page.waitForTimeout(200);
const gsvOpen = await page.evaluate(() => {
  const adv = document.querySelector('.dsh-tts-advanced');
  const fields = adv ? [...adv.querySelectorAll('.dsh-tts-field')] : [];
  return {
    open: adv ? adv.open : null,
    visible: fields.filter(el => el.getBoundingClientRect().height > 0).length,
    labels: fields.map(el => (el.querySelector('.dsh-tts-rvc-label')?.textContent || '').trim()),
    // Every advanced row (5 sliders, 1 number, 1 switch) must sit on the same
    // three columns as the ordinary dropdown rows above it.
    columns: fields.map(el => {
      const row = el.querySelector('.dsh-tts-rvc-row');
      const label = el.querySelector('.dsh-tts-rvc-label');
      const control = row && row.children[1];
      const note = el.querySelector(':scope > .dsh-tts-note');
      const one = n => Math.round(n * 10) / 10;
      return {
        labelRight: one(label.getBoundingClientRect().right),
        controlLeft: one(control.getBoundingClientRect().left),
        noteLeft: note ? one(note.getBoundingClientRect().left) : null,
        // A switch intentionally hugs the far right of the row (margin-left:auto),
        // the way the shell's own PermissionRow does. Only its label/hint columns
        // are part of the grid; inputs and sliders start at the control column.
        isSwitch: !!el.querySelector('.dsh-tts-switch'),
      };
    }),
  };
});
check('expanding advanced reveals every field as its own row',
  gsvOpen.open === true && gsvOpen.visible === 7 && new Set(gsvOpen.labels).size === 7,
  gsvOpen.labels.join(' | '));
check('expanded advanced rows share the settings-row grid',
  gsvOpen.columns.length === 7 && gsvOpen.columns.every(c =>
    Math.abs(c.labelRight - fmtGeom.labelRight) <= 1 &&
    (c.isSwitch
      ? c.controlLeft >= fmtGeom.controlLeft
      : Math.abs(c.controlLeft - fmtGeom.controlLeft) <= 1) &&
    (c.noteLeft === null || Math.abs(c.noteLeft - fmtGeom.noteLeft) <= 1)),
  JSON.stringify(gsvOpen.columns));

if (process.env.AUDIT_SHOT) {
  await page.screenshot({ path: process.env.AUDIT_SHOT });
  console.log('screenshot: ' + process.env.AUDIT_SHOT);
}
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} live UI checks passed`);
process.exit(failed === 0 ? 0 : 1);
