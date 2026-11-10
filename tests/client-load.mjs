// Loads lib/client.js in a mocked browser env, runs apply(), then renders each
// injected component with a minimal React shim to confirm the i18n refactor
// (t() everywhere + language switcher) does not crash at load/render time.
//   node tests/client-load.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); }

// ---- minimal React shim (enough for client.js's createElement + hooks) ----
const states = new Map(); // hook memory keyed by componentId
function makeHookCtx() {
  let id = Math.random().toString(36).slice(2);
  let cursor = 0;
  const arr = states.get(id) || { mem: [] };
  states.set(id, arr);
  function useState(init) {
    const i = cursor++;
    if (!(i in arr.mem)) arr.mem[i] = typeof init === 'function' ? init() : init;
    const set = v => { arr.mem[i] = typeof v === 'function' ? v(arr.mem[i]) : v; };
    return [arr.mem[i], set];
  }
  const useEffect = (fn, deps) => { cursor += 1; return fn; }; // run nothing on demand
  const useRef = init => ({ current: init });
  const useMemo = (fn) => fn();
  const useStateForce = () => useState(0);
  return { id, useState, useEffect, useRef, useMemo, reset() { cursor = 0; } };
}

const react = {
  createElement(type, props, ...children) {
    // normalize children
    if (type === react.Fragment) return { type, props: props || {}, children };
    return { type, props: props || {}, children, $$node: true };
  },
  Fragment: Symbol('Fragment'),
  useState: () => { throw new Error('useState outside shim'); },
  useEffect: () => {},
  useRef: () => ({ current: undefined }),
  useMemo: f => f(),
};

// ---- browser globals ----
const injectedComponents = [];
const slots = {
  inject(slot, fn) { injectedComponents.push({ slot, fn }); },
  register(spec, component) { return component; }, // real host returns the registered component
};
// The style effect is the only one that runs: it is pure DOM construction and
// the one place the whole stylesheet can be silently lost. Running the other
// three would register real listeners against a half-mocked window for no gain.
const injectedStyles = [];
const ctx = {
  get(name) { if (name === 'slots') return slots; return undefined; },
  effect(fn, label) {
    if (typeof label === 'string' && label.endsWith(': styles')) fn();
  },
};
try { Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true }); }
catch (e) { /* already settable */ }
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  AudioContext: function(){}, webkitAudioContext: function(){},
  confirm: () => true,
};
globalThis.document = {
  createElement: tag => {
    const el = { tagName: String(tag).toUpperCase(), dataset: {}, style: {}, setAttribute(){}, appendChild(){}, removeChild(){}, pause(){}, removeAttribute(){}, play: () => Promise.resolve(), addEventListener(){}, removeEventListener(){} };
    // insertCss builds a <style> then assigns textContent; capture the element
    // so the test can read back the sheet that would reach the document.
    if (el.tagName === 'STYLE') injectedStyles.push(el);
    return el;
  },
  body: { appendChild() {}, removeChild() {} },
  head: { appendChild() {}, removeChild() {} },
};
globalThis.Audio = function(){ this.play = () => Promise.resolve(); this.pause=()=>{}; this.setAttribute=()=>{}; this.removeAttribute=()=>{}; };
// in-memory localStorage so the i18n persistence (loadPersistedLang/setLang) works
const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
};

// ---- load the bundle ----
let failed = false;
const clientSrc = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'), 'utf8');
try {
  globalThis.window.__ModuleLoader__ = {
    load({ id, factory }) {
      // run factory with a require that returns our react shim
      const require_ = name => { if (name === 'react') return react; throw new Error('unknown require: ' + name); };
      const mod = factory(require_);
      if (!mod || !mod.apply) throw new Error('factory did not export apply');
      if (!Array.isArray(mod.inject) || !mod.inject.includes('slots'))
        throw new Error('factory must export inject including "slots" (fiber inject waiting)');
      globalThis.__dshTtsClientMod = mod;
      mod.apply(ctx);
    },
  };
  // evaluate client.js in this context
  const fn = new Function('window', 'navigator', 'document', 'Audio', clientSrc + '\n;return window.__ModuleLoader__;');
  globalThis.__dshTtsClientSrc = clientSrc;
  const ml = fn(globalThis.window, globalThis.navigator, globalThis.document, globalThis.Audio);
  check('client.js loads + apply() runs', injectedComponents.length > 0, `${injectedComponents.length} slot(s) injected`);
  check('client bundle exports inject with slots', Array.isArray(globalThis.__dshTtsClientMod?.inject) && globalThis.__dshTtsClientMod.inject.includes('slots'));

  // ---- the stylesheet that actually reaches the document ----
  // CSS is one `+`-joined literal. A stray double quote inside `content:""`
  // closes the string early, the rest of the line becomes a comment, and every
  // rule after it is dropped — while `node --check` stays green, because the
  // shortened literal is still valid JS. A regression here silently unstyles
  // the whole settings panel, so assert on the assembled sheet, not the source.
  const sheet = injectedStyles.length === 1 ? String(injectedStyles[0].textContent || '') : '';
  check('stylesheet is injected exactly once', injectedStyles.length === 1 && sheet.length > 0, `styles=${injectedStyles.length}`);
  check('stylesheet survives full concatenation', sheet.length > 20000, `len=${sheet.length}`);
  const openBraces = (sheet.match(/\{/g) || []).length;
  const closeBraces = (sheet.match(/\}/g) || []).length;
  check('stylesheet has no truncated rule', openBraces === closeBraces && sheet.trimEnd().endsWith('}'), `{=${openBraces} }=${closeBraces}`);
  check('stylesheet reaches its last rule', sheet.includes('.dsh-tts-reading-bar:hover{transform:translateX(0) scale(1.03)}'), sheet.slice(-60));
  check('stylesheet carries the picker and toast-layer rules', sheet.includes('.dsh-tts-dd-trigger{') && sheet.includes('overlayLayer'), undefined);

  // ---- i18n preference persistence (round-trip) ----
  try {
    const hooks = globalThis.window.__dshTtsI18n;
    check('i18n hook exposed for tests', !!hooks && typeof hooks.setLang === 'function');
    // switch to English -> must persist
    hooks.setLang('en');
    check('setLang("en") persists to localStorage', memStore.get('dsh-tts-lang') === 'en',
      'stored=' + memStore.get('dsh-tts-lang'));
    check('active locale resolves to en', hooks.current() === 'en', 'current()=' + hooks.current());
    // simulate reload by re-invoking the loader factory in a fresh module eval that
    // calls loadPersistedLang() from the same localStorage
    const src2 = globalThis.__dshTtsClientSrc;
    const fn2 = new Function('window', 'navigator', 'document', 'Audio', src2 + '\n;return window.__ModuleLoader__;');
    const ml2 = fn2(globalThis.window, globalThis.navigator, globalThis.document, globalThis.Audio);
    const I18N2 = globalThis.window.__dshTtsI18n;
    check('persisted language survives reload (lang=en)', I18N2.lang === 'en', 'lang=' + I18N2.lang);
    check('persisted language resolves to en after reload', I18N2.current() === 'en');
    // reset to auto for isolation
    hooks.setLang('auto');
  } catch (e) {
    check('i18n preference persistence round-trip', false, String(e && e.message || e));
  }

  // ---- settings persistence round-trip (voice/auto-read/provider/rvc) ----
  try {
    const S1 = globalThis.window.__dshTtsSettings;
    check('settings hook exposed for tests', !!S1 && typeof S1.get === 'function' && typeof S1.reset === 'function');
    // seed a "user-changed" snapshot into localStorage, then simulate a reload by
    // re-running the factory so loadSettings() applies it
    memStore.set('dsh-tts-settings', JSON.stringify({
      autoRead: true, voice: 'zh-CN-YunyangNeural', provider: 'rvc', rvcAutoFallback: true, rawMarkdown: true,
      notify: { enabled: true, approval: false, approvalResult: true, voice: 'zh-CN-YunxiNeural' },
      rvc: { baseUrl: 'http://127.0.0.1:9999', model: '/x.pth', indexRate: 0.5 },
    }));
    const srcS = globalThis.__dshTtsClientSrc;
    const fnS = new Function('window', 'navigator', 'document', 'Audio', srcS + '\n;return window.__ModuleLoader__;');
    const mlS = fnS(globalThis.window, globalThis.navigator, globalThis.document, globalThis.Audio);
    const S2 = globalThis.window.__dshTtsSettings;
    const s2 = S2.get();
    check('settings loaded from localStorage', s2.autoRead === true && s2.voice === 'zh-CN-YunyangNeural' && s2.provider === 'rvc', JSON.stringify(s2));
    check('rvcAutoFallback loaded from localStorage', s2.rvcAutoFallback === true, 'rvcAutoFallback=' + s2.rvcAutoFallback);
    check('notify settings loaded from localStorage', s2.notify.enabled === true && s2.notify.approval === false && s2.notify.approvalResult === true && s2.notify.voice === 'zh-CN-YunxiNeural', JSON.stringify(s2.notify));
    check('rvc settings loaded from localStorage', s2.rvc.baseUrl === 'http://127.0.0.1:9999' && s2.rvc.model === '/x.pth' && s2.rvc.indexRate === 0.5, JSON.stringify(s2.rvc));
    check('rawMarkdown loaded from localStorage', s2.rawMarkdown === true, 'rawMarkdown=' + s2.rawMarkdown);
    // layered storage: save() must NOT persist service-class keys to localStorage
    S2.save();
    try {
      const persisted = JSON.parse(memStore.get('dsh-tts-settings'));
      const hasService = persisted && persisted.rvc &&
        ('baseUrl' in persisted.rvc || 'model' in persisted.rvc || 'index' in persisted.rvc);
      check('save() strips Host service keys from localStorage', hasService === false, JSON.stringify(persisted.rvc));
      check('save() keeps UI prefs in localStorage', persisted.rawMarkdown === true && persisted.rvc.indexRate === 0.5, JSON.stringify(persisted));
    } catch (e) {
      check('save() strips Host service keys from localStorage', false, String(e && e.message || e));
    }
    // reset: restore defaults + drop stored settings
    S2.reset();
    const r = S2.get();
    check('reset restores defaults', r.autoRead === false && r.voice === 'zh-CN-XiaoxuanNeural' && r.provider === 'edge-tts' && r.rvcAutoFallback === false, JSON.stringify(r));
    check('reset restores notify defaults', r.notify.enabled === false && r.notify.approval === true && r.notify.approvalResult === false && r.notify.voice === 'zh-CN-XiaoxuanNeural', JSON.stringify(r.notify));
    check('reset clears stored settings', !memStore.has('dsh-tts-settings'));
    // corrupt stored JSON must not crash; falls back to defaults
    memStore.set('dsh-tts-settings', '{not json');
    const fnC = new Function('window', 'navigator', 'document', 'Audio', srcS + '\n;return window.__ModuleLoader__;');
    fnC(globalThis.window, globalThis.navigator, globalThis.document, globalThis.Audio);
    const S3 = globalThis.window.__dshTtsSettings;
    check('corrupt stored settings ignored (defaults)', S3.get().voice === 'zh-CN-XiaoxuanNeural');
    memStore.delete('dsh-tts-settings');
  } catch (e) {
    check('settings persistence round-trip', false, String(e && e.stack || e));
  }
} catch (e) {
  check('client.js loads + apply() runs', false, String(e && e.stack || e));
  failed = true;
}

// ---- render each injected component with the shim to catch t()/render errors ----
if (!failed) {
  for (const { slot, fn } of injectedComponents) {
    try {
      const Component = fn(); // fn returns a component function
      if (typeof Component !== 'function') { check(`render ${slot}`, false, 'slot fn did not return a component'); continue; }
      const h = makeHookCtx();
      let prev = react;
      // temporarily bind react hooks to the shim's hooks
      const originalReact = globalThis.__reactShim || react;
      // The component was defined against `react` from the factory closure. We can't
      // easily intercept that closure's react, but we CAN mock react's hooks via the
      // module-level `react` object we passed. Since useState threw by default, patch it:
      const orig = { useState: react.useState, useEffect: react.useEffect, useRef: react.useRef, useMemo: react.useMemo };
      react.useState = h.useState; react.useEffect = h.useEffect; react.useRef = h.useRef; react.useMemo = h.useMemo;
      const node = Component({
        useSession: sel => sel({ nodes: [] }),
        messageId: 'm1',
      });
      react.useState = orig.useState; react.useEffect = orig.useEffect; react.useRef = orig.useRef; react.useMemo = orig.useMemo;
      // `null` is a legitimate conditional render (e.g. the toast host when no
      // toast is active); only `undefined`/throw counts as broken.
      check(`render ${slot}`, node !== undefined, node === null ? '(conditional null)' : undefined);
    } catch (e) {
      check(`render ${slot}`, false, String(e && e.stack || e).slice(0, 200));
    }
  }
}

// P2-1: auto-read toggle is now a labeled pill (headphones + dot), distinct
// from a mic/speaker — verifies the reworked element structure renders.
{
  const comp = injectedComponents.find(c => c.slot === 'conversation.input.left');
  if (comp) {
    try {
      const h = makeHookCtx();
      const orig = { useState: react.useState, useEffect: react.useEffect, useRef: react.useRef, useMemo: react.useMemo };
      react.useState = h.useState; react.useEffect = h.useEffect; react.useRef = h.useRef; react.useMemo = h.useMemo;
      const node = comp.fn()({});
      react.useState = orig.useState; react.useEffect = orig.useEffect; react.useRef = orig.useRef; react.useMemo = orig.useMemo;
      const hasClass = (n, cls) => {
        if (!n) return false;
        if (n.props && n.props.className === cls) return true;
        const ch = n.children;
        if (Array.isArray(ch)) { for (const c of ch) { if (hasClass(c, cls)) return true; } }
        return false;
      };
      check('auto-read rendered as labeled pill', hasClass(node, 'dsh-tts-auto-pill') && hasClass(node, 'dsh-tts-auto-label'), undefined);
    } catch (e) {
      check('auto-read rendered as labeled pill', false, String(e && e.stack || e).slice(0, 200));
    }
  }
}

// Toast: showToast() must render a visible toast node in shell.overlay with the
// message; dismissToast() must remove it. (This is the error-surfacing channel
// added for message read-aloud / auto-read failures + RVC fallback notices.)
{
  const toastApi = globalThis.window.__dshTtsToast;
  if (toastApi && typeof toastApi.show === 'function') {
    const hasClass = (n, cls) => {
      if (!n) return false;
      if (n.props && typeof n.props.className === "string" &&
          n.props.className.split(/\s+/).includes(cls)) return true;
      const ch = n.children;
      if (Array.isArray(ch)) { for (const c of ch) { if (hasClass(c, cls)) return true; } }
      return false;
    };
    const allText = n => {
      if (!n) return '';
      if (typeof n === 'string' || typeof n === 'number') return String(n);
      const ch = n.children;
      if (Array.isArray(ch)) return ch.map(allText).join('');
      return '';
    };
    const overlayComps = injectedComponents.filter(c => c.slot === 'shell.overlay');
    try {
      toastApi.show('语音合成失败：boom', 'error');
      // render with the shim hooks
      const h = makeHookCtx();
      const orig = { useState: react.useState, useEffect: react.useEffect, useRef: react.useRef, useMemo: react.useMemo };
      react.useState = h.useState; react.useEffect = h.useEffect; react.useRef = h.useRef; react.useMemo = h.useMemo;
      const rendered = overlayComps.map(({ fn }) => fn()({}));
      react.useState = orig.useState; react.useEffect = orig.useEffect; react.useRef = orig.useRef; react.useMemo = orig.useMemo;
      const toastNodes = rendered.filter(n => hasClass(n, 'dsh-tts-toast'));
      const withText = toastNodes.filter(n => allText(n).includes('语音合成失败：boom'));
      check('toast renders in shell.overlay with message', toastNodes.length >= 1 && withText.length >= 1,
        `toastNodes=${toastNodes.length} textFound=${withText.length}`);
      // dismiss -> no toast rendered anymore
      toastApi.dismiss();
      const h2 = makeHookCtx();
      const orig2 = { useState: react.useState, useEffect: react.useEffect, useRef: react.useRef, useMemo: react.useMemo };
      react.useState = h2.useState; react.useEffect = h2.useEffect; react.useRef = h2.useRef; react.useMemo = h2.useMemo;
      const rendered2 = overlayComps.map(({ fn }) => fn()({}));
      react.useState = orig2.useState; react.useEffect = orig2.useEffect; react.useRef = orig2.useRef; react.useMemo = orig2.useMemo;
      check('toast dismissed removes toast node', rendered2.filter(n => hasClass(n, 'dsh-tts-toast')).length === 0);
    } catch (e) {
      check('toast renders + dismisses', false, String(e && e.stack || e).slice(0, 200));
    }
  } else {
    check('toast hook exposed (__dshTtsToast)', false, 'hook missing');
  }
}

// Settings tab renders the approval voice-alert module (title visible).
{
  const comp = injectedComponents.find(c => c.slot === 'settings.plugins.tab');
  if (comp) {
    try {
      const allText = n => {
        if (!n) return '';
        if (typeof n === 'string' || typeof n === 'number') return String(n);
        const ch = n.children;
        if (Array.isArray(ch)) return ch.map(allText).join('');
        return '';
      };
      const h = makeHookCtx();
      const orig = { useState: react.useState, useEffect: react.useEffect, useRef: react.useRef, useMemo: react.useMemo };
      react.useState = h.useState; react.useEffect = h.useEffect; react.useRef = h.useRef; react.useMemo = h.useMemo;
      const node = comp.fn()({ useSession: sel => sel({ nodes: [] }), messageId: 'm1' });
      react.useState = orig.useState; react.useEffect = orig.useEffect; react.useRef = orig.useRef; react.useMemo = orig.useMemo;
      // Boolean options are rendered as the shell's own switch (button[role=switch]),
      // never as a native checkbox whose label repeats the row title.
      const collectSwitches = n => {
        const out = [];
        const walk = x => {
          if (!x || typeof x !== 'object') return;
          // TtsSwitch is a plain function component with no hooks — evaluate it
          // so the assertion sees the real button[role=switch] it produces.
          if (typeof x.type === 'function' && x.props && x.props.checked !== undefined) {
            let sub = null;
            try { sub = x.type(x.props); } catch (e) { sub = null; }
            if (sub && sub.props && sub.props.role === 'switch') out.push({ props: sub.props, label: x.props.label });
            return;
          }
          if (x.props && x.props.role === 'switch') out.push(x);
          const ch = x.children;
          if (Array.isArray(ch)) ch.forEach(walk);
        };
        walk(n);
        return out;
      };
      const collectCheckboxes = n => {
        let count = 0;
        const walk = x => {
          if (!x || typeof x !== 'object') return;
          if (x.type === 'input' && x.props && x.props.type === 'checkbox') count += 1;
          const ch = x.children;
          if (Array.isArray(ch)) ch.forEach(walk);
        };
        walk(n);
        return count;
      };
      const switches = collectSwitches(node);
      const notifySwitch = switches.some(s => s.props['aria-label'] === '启用审批语音提醒');
      check('settings renders approval voice-alert module', allText(node).includes('事件语音提醒') && notifySwitch, `switches=${switches.length}`);
      check('settings uses switches instead of native checkboxes', switches.length >= 4 && collectCheckboxes(node) === 0, `switches=${switches.length} boxes=${collectCheckboxes(node)}`);
      check('switches expose aria-checked state', switches.every(s => s.props['aria-checked'] === 'true' || s.props['aria-checked'] === 'false'), undefined);
      // The switch is copied verbatim from primitives/lib/Switch.module.css. Without
      // box-sizing the 2px padding inflates the 36x20 track to 40x24, so the radius
      // reads as 12 instead of 10 and the thumb sits 2px off centre; without
      // corner-shape:round the capsule falls back to the shell's superellipse. Neither
      // regression is visible to a DOM assertion, hence the source check.
      const swRule = (clientSrc.match(/\.dsh-tts-switch\{[^}]*\}/) || [''])[0];
      check('switch copies the shell spec (border-box + corner-shape)', swRule.includes('box-sizing:border-box') && swRule.includes('corner-shape:round') && swRule.includes('width:36px') && swRule.includes('height:20px'), swRule.slice(0, 64));
      // Form controls take their corner from the shell's radius scale (4/8/12/16/20/28),
      // never from a hand-picked px value — the earlier 8px set read as a different product.
      const ctlClasses = ['ctl', 'dd-trigger', 'dd-item', 'dd-menu', 'rvc-input', 'preview-input', 'browse'];
      const ctlRules = ctlClasses.map(c => (clientSrc.match(new RegExp('\\.dsh-tts-' + c + '\\{[^}]*\\}')) || [''])[0]).filter(Boolean);
      check('controls take their radius from --dsw-radius-* tokens', ctlRules.length === ctlClasses.length && ctlRules.every(r => /border-radius:var\(--dsw-radius-/.test(r)), `rules=${ctlRules.length}`);
      // A picker on a settings row is PermissionRow's .selector, NOT the
      // composer's transparent 28px .trigger / AgentPresetSeat. The shell's
      // settings selector has a default --dsw-alias-bg-module-platform fill
      // (the light-grey block in the permission row), 36px height, radius-md,
      // 14px primary ink, padding 0 14px and a 12px label/chevron gap.
      // Copying the composer seat here made our picker read as bare text —
      // that regression is invisible to a DOM assertion, so pin it in source.
      const pickerRule = (clientSrc.match(/\.dsh-tts-dd-trigger\{[^}]*\}/) || [''])[0];
      check('settings-row picker copies PermissionRow.selector (filled 36px)',
        pickerRule.includes('height:36px') && pickerRule.includes('border:none') &&
        pickerRule.includes('background:var(--dsw-alias-bg-module-platform)') &&
        pickerRule.includes('border-radius:var(--dsw-radius-md)') &&
        pickerRule.includes('font-size:14px') && pickerRule.includes('gap:12px') &&
        pickerRule.includes('padding:0 14px') && !pickerRule.includes('background:0 0'),
        pickerRule.slice(0, 72));
      // :disabled only changes the cursor in the shell; clearing the fill there
      // (or on hover) is how the transparent seat crept back in twice.
      const disabledRule = (clientSrc.match(/\.dsh-tts-dd-trigger:disabled\{[^}]*\}/) || [''])[0];
      const hoverRule = (clientSrc.match(/\.dsh-tts-dd-trigger:hover:not\(:disabled\)\{[^}]*\}/) || [''])[0];
      check('picker keeps its fill when disabled and on hover',
        disabledRule.includes('cursor:default') && !disabledRule.includes('background:0 0') &&
        hoverRule.includes('background:var(--dsw-alias-interactive-bg-hover)'),
        `disabled=${disabledRule.slice(0, 48)} hover=${hoverRule.slice(0, 48)}`);
      // PermissionRow's PopupSelect uses align:"end": the surface grows left from
      // the trigger's right edge. left:0 made long option labels spill out of the
      // settings dialog on the right.
      const alignRule = (clientSrc.match(/\.dsh-tts-module>\.dsh-tts-dd \.dsh-tts-dd-menu\{[^}]*\}/) || [''])[0];
      check('settings-row menu is end-aligned like PopupSelect',
        alignRule.includes('left:auto') && alignRule.includes('right:0'), alignRule);
      // The provider card has its own 0.5px border and sits at gap:0 from the row
      // above it. Without this rule the row's bottom hairline and the card's top
      // stroke land on the same pixel and look like a broken/doubled border.
      const cardEdgeRule = (clientSrc.match(/\.dsh-tts-module:not\(\.dsh-tts-rvc\):has\(\+ \.dsh-tts-rvc\)\{[^}]*\}/) || [''])[0];
      check('row before a provider card drops its hairline',
        cardEdgeRule.includes('border-bottom:none'), cardEdgeRule);
      // RVC stacks two cards back to back. The :not() above keeps the first card's
      // bottom stroke; this gap stops that stroke from touching the next card's top.
      const cardGapRule = (clientSrc.match(/\.dsh-tts-rvc \+ \.dsh-tts-rvc\{[^}]*\}/) || [''])[0];
      check('stacked provider cards keep a gap', cardGapRule.includes('margin-top:12px'), cardGapRule);
      // ...while a picker inside a form field must keep the input's box, or the row
      // loses its shared baseline. Both field selectors also reset the selector's
      // roomy 12px gap back to the field's 4px.
      check('field-row picker shares the input box', /\.dsh-tts-rvc-row \.dsh-tts-dd-trigger\{[^}]*height:32px[^}]*gap:4px/.test(clientSrc) &&
        /\.dsh-tts-path \.dsh-tts-dd-trigger\{[^}]*height:32px[^}]*gap:4px/.test(clientSrc), undefined);
      // A path row holds only inputs / pickers / buttons, so every child takes the
      // field box. The previous rule targeted .dsh-tts-rvc-row, where no button
      // ever sits — it was dead CSS and the buttons stayed 28px beside a 32px
      // input. Pin the selector that actually matches.
      const pathBtn = (clientSrc.match(/\.dsh-tts-path \.dsh-tts-browse\{[^}]*\}/) || [''])[0];
      check('path-row buttons take the field height', pathBtn.includes('height:32px') && pathBtn.includes('border-radius:var(--dsw-radius-md)'), pathBtn.slice(0, 56));
      check('no dead browse rule under a label row', !/\.dsh-tts-rvc-row \.dsh-tts-browse\{/.test(clientSrc), undefined);
      // A field note starts at the control column: label 110px + row gap 10px.
      // The old 110px left every hint 10px behind the input above it.
      const noteRule = (clientSrc.match(/\.dsh-tts-note\{[^}]*\}/) || [''])[0];
      const rowRule = (clientSrc.match(/\.dsh-tts-rvc-row\{[^}]*\}/) || [''])[0];
      const labelRule = (clientSrc.match(/\.dsh-tts-rvc-label\{[^}]*\}/) || [''])[0];
      const gap = Number((rowRule.match(/gap:(\d+)px/) || [])[1]);
      const label = Number((labelRule.match(/width:(\d+)px/) || [])[1]);
      const indent = Number((noteRule.match(/margin:[^;]*?\s(\d+)px/) || [])[1]);
      check('field notes align to the control column', indent === label + gap, `indent=${indent} label=${label} gap=${gap}`);
      // Settings rows use the shell's own rhythm: 16px block padding, a half-pixel
      // l2 rule, and secondary ink for the description.
      const modRule = (clientSrc.match(/\.dsh-tts-module\{[^}]*\}/) || [''])[0];
      check('settings rows copy the shell rhythm', modRule.includes('padding:16px 0') && modRule.includes('0.5px solid var(--dsw-alias-border-l2)') && modRule.includes('gap:24px'), modRule.slice(0, 56));
      check('settings renders export-diagnostic-log button', allText(node).includes('导出诊断日志') && allText(node).includes('运行诊断'), undefined);
      // Entry CTAs removed: provider switch is the only entry (no shortcut cards)
      check('settings hides removed entry CTAs (edge mode)', !allText(node).includes('需要克隆音色') && !allText(node).includes('Index-TTS2 音色'), undefined);
      check('settings shows rawMarkdown toggle', allText(node).includes('朗读原始'), undefined);
      check('settings bottom shows bug-report hint', allText(node).includes('导出诊断日志') && allText(node).includes('红色报错') && allText(node).includes('https://github.com/1624318455/dsh-plugin-tts/issues'), undefined);
    } catch (e) {
      check('settings renders approval voice-alert module', false, String(e && e.stack || e).slice(0, 200));
    }
  }
}

// Single-file (short-text) reads must seed chunkProgress/readingIndex so the
// overlay, scroll-follow and click-to-pause activate without the chunked path.
// Regression test for "朗读高度跟随有时不生效 / 点击朗读中按钮无反应".
{
  try {
    const src = globalThis.__dshTtsClientSrc || '';
    // 1) speakText seeds 1/1 progress right after readingSentenceIdx reset
    const seedOk = /shared\.readingSentenceIdx\s*=\s*0;[\s\S]{0,1200}?shared\.chunkProgress\s*=\s*\{\s*index:\s*1,\s*total:\s*1\s*\}[\s\S]{0,200}?shared\.readingIndex\s*=\s*1;/.test(src);
    check('speakText seeds 1/1 progress for single-file reads', seedOk);
    // 2) overlay visible gate accepts total >= 1 (not > 1)
    check('overlay visible accepts total >= 1', /cp\s*&&\s*cp\.total\s*>=\s*1/.test(src));
    // 3) hidden bar must not intercept clicks: pointer-events:none by default,
    //    auto only under [data-visible]
    const barDefaultNone = /\.dsh-tts-reading-bar\{[^}]*pointer-events:none/.test(src);
    const barVisibleAuto = /\.dsh-tts-reading-overlay\[data-visible\][^{]*\.dsh-tts-reading-bar\{[^}]*pointer-events:auto/.test(src);
    check('hidden bar does not intercept clicks', barDefaultNone && barVisibleAuto,
      `defaultNone=${barDefaultNone} visibleAuto=${barVisibleAuto}`);
    // 4) onBarClick never throws on missing event + reads live shared.speaking
    const clickOk = /const onBarClick[\s\S]{0,600}?typeof e\.stopPropagation[\s\S]{0,200}?shared\.speaking\) togglePause\(\)/.test(src);
    check('onBarClick hardened (no-throw + live speaking)', clickOk);
    // 5) scroll-follow v2: block-index stepwise signal, visibility-driven
    // minimal scrolling (no polling loop), latch-off with manual resume.
    const stepOk = /const ttsBlockIdx = \(\) =>/.test(src) && /ttsBlockHead/.test(src) &&
      !/ttsLiveRatio/.test(src) && !/chunkStartedAt \|\| Date\.now\(\)\)\) \/ 1000/.test(src);
    const noPoll = !/setInterval\(keepVisible/.test(src) && !/setInterval\(ttsFollowTick/.test(src);
    const latchOk = /ttsFollow\.latched = false/.test(src) && /follow\.resume/.test(src) &&
      !/ttsUserScrollAt\.t < 5000/.test(src);
    check('scroll-follow v2 stepwise signal, no poll, latch-off resume', stepOk && noPoll && latchOk,
      `step=${stepOk} noPoll=${noPoll} latch=${latchOk}`);
    // 5b) self-scroll fence via timestamp + scrollend (covers smooth-scroll
    // duration); takeover sources are wheel/touchmove/pointer-drag only, so
    // host autoscroll during streaming never latches follow off.
    const selfOk = /ttsFollow\.selfUntil = Date\.now\(\) \+ 600/.test(src) && /scrollend/.test(src);
    const takeOk = /onTouchMove/.test(src) && /onPointerMove/.test(src) && /onWheel/.test(src);
    check('follow self-fence + gesture takeover sources', selfOk && takeOk,
      `self=${selfOk} take=${takeOk}`);
    // 5c) message anchor: button click climbs to the message root (WeakRef),
    // fingerprint relocate survives re-renders; paragraph hits are never
    // cached as anchors (fragile, single-tick use).
    const anchorOk = /shared\.readingMsgEl = new WeakRef\(best\)/.test(src) &&
      /shared\.readingMsgEl \? shared\.readingMsgEl\.deref\(\) : null/.test(src);
    check('follow uses anchored message element', anchorOk);
    // 5d) anchor survives re-render (fingerprint relocate) + wrong-element
    // guard (never rubber-band on an absurd hit) + nearest-scroll.
    const relocOk = /shared\.readingMsgKey = \{ head/.test(src) && /mark\("relocated"\)/.test(src);
    const guardOk = /mark\("bad-target"\)/.test(src) && /block:"nearest"/.test(src);
    check('anchor relocates + bad target skipped', relocOk && guardOk,
      `reloc=${relocOk} guard=${guardOk}`);
    // 5e) reduced-motion respected: follow bails before touching the view.
    check('follow respects prefers-reduced-motion', /ttsReducedMotion\(\)/.test(src) && /mark\("reduced-motion"\)/.test(src));
    // 5f) exact server spans feed the block locator when present (P1-3),
    // equal-division fallback otherwise; spans reset per utterance.
    const spansOk = /shared\.chunkSpans = Array\.isArray\(result\.spans\)/.test(src) &&
      /shared\.chunkSpans = null/.test(src) && /sp\[idx - 1\]\[0\]/.test(src);
    check('follow consumes server block spans with fallback', spansOk);
    // 6) compact bar: no "n / total" counter in bar text (tooltip only)
    const noCounter = !/overlay\.reading"\)\) \+ "  " \+ idx/.test(src) && !/\("overlay\.paused"\) : t\("overlay\.reading"\)\) \+/.test(src);
    const pausedOk = /shared\.paused \? t\("overlay\.paused"\) : t\("overlay\.reading"\)(?!\) \+)/.test(src);
    check('bar compact: paused/reading text only, no counter', noCounter && pausedOk,
      `noCounter=${noCounter} pausedOk=${pausedOk}`);
    // 7) v2 block highlight restored as the visual anchor for follow: soft
    // background, never the old box-shadow style.
    const hlCss = /\.dsh-tts-sentence-active\{[^}]*background/.test(src);
    const noShadowCss = !/\.dsh-tts-sentence-active\{[^}]*box-shadow/.test(src);
    const addActive = /classList\.add\("dsh-tts-sentence-active"\)/.test(src);
    check('block highlight restored (soft bg, no shadow)', hlCss && noShadowCss && addActive,
      `css=${hlCss} noShadow=${noShadowCss} add=${addActive}`);
    // 8) playback mutual exclusion: playSeq generation guards all audio
    // callbacks; stop hard-aborts decode via load(); chunk queue is indexed
    // (no push-on-resolve reorder).
    const seqBump = /shared\.playSeq = \(shared\.playSeq \|\| 0\) \+ 1/.test(src);
    const seqGuard = (src.match(/shared\.playSeq === mySeq/g) || []).length >= 4;
    const loadAbort = /el\.load\(\);/.test(src);
    const indexedQ = /const queue = new Array\(total\)/.test(src) && /queue\[want\] = r\.url/.test(src) && /queue\[cursor\]/.test(src);
    const noPush = !/queue\.push\(r\.url\)/.test(src);
    check('playback generation guards callbacks (no overlap)', seqBump && seqGuard,
      `bump=${seqBump} guards=${(src.match(/shared\.playSeq === mySeq/g) || []).length}`);
    check('stop aborts decode via load()', loadAbort);
    check('chunk queue indexed by chunk idx (no reorder)', indexedQ && noPush,
      `indexed=${indexedQ} noPush=${noPush}`);
    // 9) fluency trio: skipped-slot advance, stall watchdog (text-only,
    // never touches playbackRate — varispeed would deepen the timbre).
    const skipSlot = /queue\[want\] = false/.test(src) && /queue\[cursor\] === false/.test(src);
    const stallDog = /shared\.stalling = true/.test(src) && /chunk\.stalling/.test(src)
      && !/stallStretch/.test(src) && !/\*\s*0\.85/.test(src);
    check('skipped chunks advance without gap', skipSlot);
    check('stall watchdog shows synthesizing, rate untouched', stallDog);
    // 10) starvation clamp: a chunk decoded late must start at now, never in
    // the past (past start plays immediately while bookkeeping lags, so the
    // next chunk overlaps the tail — sustained RTF > 1, e.g. local CosyVoice).
    const starveClamp = /Math\.max\(nextStart,\s*ctx\.currentTime/.test(src);
    check('starved chunk clamps to now (no tail overlap)', starveClamp);
  } catch (e) {
    check('single-file progress regression checks', false, String(e && e.stack || e).slice(0, 200));
  }
}

// Archived-session guard: archiving the session being read aloud must STOP
// the read (the session left the workspace, so speaking for it is nonsense).
// Regression test for "归档了正在朗读的会话，session 已从工作区消失但仍在读".
{
  const A = globalThis.window.__dshTtsArchive;
  if (!A || typeof A.sync !== 'function') {
    check('archive guard hook exposed (__dshTtsArchive)', false, 'hook missing');
  } else {
    // 1) the guard tracks the Host's archive set
    A.sync(['sess-a', 'sess-b']);
    check('archive guard tracks the host archive set',
      A.isArchived('sess-a') === true && A.isArchived('sess-b') === true && A.isArchived('sess-z') === false,
      'archived=' + JSON.stringify(A.archived()));
    // 2) an archived session may not start a new read
    check('archived session cannot start a read',
      A.canRead('sess-a') === false && A.canRead('sess-z') === true);
    // 3) a session-less read (settings preview / selection) is always allowed
    check('session-less read is always allowed', A.canRead(null) === true);
    // 4) unarchive removes the member again (the host set is authoritative)
    A.sync(['sess-b']);
    check('unarchive clears the archived member',
      A.isArchived('sess-a') === false && A.isArchived('sess-b') === true,
      'archived=' + JSON.stringify(A.archived()));
    // 5) syncing the set while nothing is playing must not report a stop
    check('archive sync without a read reports no stop', A.sync(['sess-b']) === false);
    // 6) source-level: the guard subscribes to the workspaces root hook and
    //    stops the read through stopSpeaking()
    const src = globalThis.__dshTtsClientSrc || '';
    const usesHook = /useWorkspaces/.test(src);
    const stopsRead = /if \(readArchived\) \{\s*stopSpeaking\(\);/.test(src);
    const tracksSession = /shared\.readSessionId = sessionId;/.test(src);
    const guardsStart = /if \(!canReadSession\(sessionId\)\) \{/.test(src);
    const clearsOnStop = /shared\.readSessionId = null;/.test(src);
    check('archive guard stops the read and refuses a new one',
      usesHook && stopsRead && tracksSession && guardsStart && clearsOnStop,
      `hook=${usesHook} stop=${stopsRead} track=${tracksSession} guard=${guardsStart} clear=${clearsOnStop}`);
  }
}

// ---- Text preprocessing rules (issue #6): functional contract ----
// Drives the __dshTtsPreprocess hook so the rule engine is exercised as code,
// not just as source text: order, flags, groups, invalid patterns, and the
// empty-output guard all live here.
{
  const P = globalThis.window.__dshTtsPreprocess;
  if (!P || typeof P.apply !== 'function') {
    check('preprocess hook exposed (__dshTtsPreprocess)', false, 'hook missing');
  } else {
    const saved = P.rules();
    P.set([]);
    check('no rules -> Markdown cleanup only, brackets untouched',
      P.plain('（笑）hello **bold**') === '（笑）hello bold');

    P.set([{ pattern: '（[^）]*）', replace: '', enabled: true }]);
    check('zh-bracket template strips interjections',
      P.plain('他嘿嘿一笑（笑），转身离开') === '他嘿嘿一笑，转身离开');
    check('rule replaces every occurrence (forced g flag)',
      P.plain('（笑）（叹气）好的') === '好的');

    P.set([{ pattern: '【(.+?)】', replace: '$1', enabled: true }]);
    check('replacement supports $1 group refs', P.plain('【重点】内容') === '重点内容');

    P.set([
      { pattern: '（[^）]*）', replace: '', enabled: false },
      { pattern: '省略', replace: '…', enabled: true },
    ]);
    check('disabled rule is skipped, enabled one still runs', P.plain('他（笑）说省略') === '他（笑）说…');

    P.set([{ pattern: '([unclosed', replace: '', enabled: true }]);
    let threw = false;
    try { P.plain('正常文本'); } catch (e) { threw = true; }
    check('invalid regex is flagged and skipped without throwing',
      !threw && P.valid({ pattern: '([unclosed' }) === false &&
      P.plain('正常文本') === '正常文本');

    P.set([
      { pattern: 'aaa', replace: 'bbb', enabled: true },
      { pattern: 'bbb', replace: 'ccc', enabled: true },
    ]);
    check('rules apply sequentially (later rule sees earlier output)',
      P.plain('aaa') === 'ccc');

    P.set([{ pattern: '.*', replace: '', enabled: true }]);
    check('a rule that erases everything yields empty output (read guard bails)',
      P.plain('whatever') === '');

    // rawMarkdown mode opts out of Markdown cleanup but NOT of user rules.
    const src = globalThis.__dshTtsClientSrc || '';
    check('rawMarkdown branch wraps in applyPreprocess too',
      /applyPreprocess\(\s*String\(text \|\| ""\)/.test(src) &&
      /\.trim\(\)\s*\);/.test(src));

    // persistence round-trip: rules survive save -> localStorage
    P.set([{ pattern: '（[^）]*）', replace: '', enabled: true }]);
    globalThis.window.__dshTtsSettings.save();
    let stored = null;
    try { stored = JSON.parse(memStore.get('dsh-tts-settings') || 'null'); } catch (e) {}
    check('rules persist to localStorage via saveSettings',
      stored && Array.isArray(stored.preprocess) && stored.preprocess.length === 1 &&
      stored.preprocess[0].pattern === '（[^）]*）');

    // settings UI: rule rows, add/template actions, live preview, guardrails
    const cssText = String((injectedStyles[0] && injectedStyles[0].textContent) || '');
    check('preprocess panel renders rule rows with template buttons and preview',
      src.includes('className: "dsh-tts-prep-list"') &&
      src.includes('className: "dsh-tts-prep-row"') &&
      src.includes('"dsh-tts-prep-input dsh-tts-prep-pattern"') &&
      src.includes('t("prep.tplZh")') && src.includes('t("prep.tplEn")') &&
      src.includes('t("prep.testTitle")') &&
      /shared\.preprocess\.length < PREPROCESS_MAX_RULES/.test(src) &&
      /\.dsh-tts-prep-row\{[^}]*display:flex;align-items:center;gap:8px/.test(cssText) &&
      /\.dsh-tts-prep-row\[data-invalid='true'\]/.test(cssText));
    P.set(saved);
  }
}

// ---- GPT-SoVITS settings polish: source-level contract ----
// Asserted on source + the ASSEMBLED stylesheet, so a later edit cannot
// silently re-merge the setup steps, restore the JSON blob, or copy a
// third-party slider spec back in.
{
  const src = globalThis.__dshTtsClientSrc || '';
  const cssText = String((injectedStyles[0] && injectedStyles[0].textContent) || '');

  check('setup steps are separate list rows, not one newline-joined paragraph',
    src.includes('className: "dsh-tts-steps"') &&
    src.includes('t("gsv.help.step1")') && src.includes('t("gsv.help.step4")') &&
    !src.includes('gsv.help.body') &&
    /\.dsh-tts-steps\{[^}]*flex-direction:column;gap:8px/.test(cssText) &&
    /\.dsh-tts-steps li::before\{[^}]*counter\(dsh-step\)[^}]*corner-shape:round/.test(cssText),
    'ol/li + numbered badge + 8px row gap');

  check('advanced params are a collapsible panel with one control per native /tts field',
    /"details",\s*\{ className: "dsh-tts-advanced" \},\s*react\.createElement\("summary", null, t\("section\.advanced"\)\)/.test(src) &&
    ['top_k', 'top_p', 'temperature', 'repetition_penalty', 'batch_size', 'seed', 'parallel_infer']
      .every(k => src.includes('"' + k + '"')) &&
    !src.includes('gsv.field.extra') && !src.includes('rows: 4'),
    '7 discrete fields, no JSON textarea');

  check('advanced panel keeps the host extraBody string contract intact',
    src.includes('setGsv("extraBody", JSON.stringify(o))') &&
    src.includes('JSON.parse(shared.gsv.extraBody || "{}")') &&
    src.includes('o[nativeKey] = value;'),
    'unknown keys survive; host /tts payload unchanged');

  const rangeCalls = (src.match(/rangeControl\(/g) || []).length;
  check('all four providers render the same rangeControl slider DOM',
    src.includes('const rangeControl = (value, onChange, min, max, step, fmt) =>') &&
    /const slider = \(key, min, max, step, fmt\) =>\s*rangeControl\(shared\.rvc\[key\]/.test(src) &&
    /const cosySlider = \(key, min, max, step, fmt\) =>\s*rangeControl\(shared\.cosy\[key\]/.test(src) &&
    /const indexSlider = \(key, min, max, step, fmt\) =>\s*rangeControl\(shared\.index\[key\]/.test(src) &&
    rangeCalls >= 6,
    rangeCalls + ' call sites, one DOM shape');

  check('speed and Index maxSeg are sliders, not number inputs',
    /t\("gsv\.field\.speed"\),\s*rangeControl\(/.test(src) &&
    /t\("index\.field\.maxSeg"\),\s*rangeControl\(/.test(src) &&
    !src.includes('indexNum("maxTextTokensPerSegment"'),
    'bounded numeric fields use sliders');

  check('slider rows use the same settings-row grid as dropdown rows',
    !/\.dsh-tts-rvc-row:has\(>\.dsh-tts-slider\)\{flex-direction:column/.test(cssText) &&
    !/\.dsh-tts-rvc-row:has\(>\.dsh-tts-slider\)>\.dsh-tts-rvc-label\{/.test(cssText) &&
    !/\.dsh-tts-field:has\(\.dsh-tts-slider\)>\.dsh-tts-note\{margin-left:0\}/.test(cssText) &&
    /\.dsh-tts-slider\{[^}]*min-height:32px/.test(cssText) &&
    /\.dsh-tts-slider input\[type=range\]\{[^}]*height:18px/.test(cssText) &&
    /\.dsh-tts-slider-scale\{[^}]*line-height:14px/.test(cssText),
    '110px label column / 120px control+hint column / 32px field box');

  check('slider round parts use official radius tokens and corner-shape:round',
    /\.dsh-tts-slider input\[type=range\]\{[^}]*corner-shape:round/.test(cssText) &&
    /::-webkit-slider-thumb\{[^}]*corner-shape:round/.test(cssText) &&
    /::-moz-range-thumb\{[^}]*corner-shape:round/.test(cssText) &&
    /\.dsh-tts-slider-value\{[^}]*border-radius:var\(--dsw-radius-sm\)/.test(cssText),
    'round parts opt out of the shell squircle');

  check('no third-party slider spec leaked into the design system',
    !src.includes('linxin666') && !src.includes('TJMolG_'),
    'only first-party @deepseek-ai tokens are referenced');
}

// ---- provider labels: one bare engine name per entry, in both locales ----
// The menu used to mix a Chinese description, full-width parentheses and an
// engine name (自定义音色（RVC）/ 本地音色（Index-TTS2）/ …). Now the label is
// just the engine name and the hint column (在线 / 本地) is the only secondary
// text, so six rows read as one list instead of six differently-shaped phrases.
{
  const src = globalThis.__dshTtsClientSrc || '';
  const expected = {
    'provider.rvc': 'RVC',
    'provider.index': 'IndexTTS-2',
    'provider.cosy': 'CosyVoice2.0',
    'provider.cloud': 'Cloud TTS',
    'provider.gsv': 'GPT-SoVITS',
  };
  const found = {};
  for (const key of Object.keys(expected)) {
    const re = new RegExp('"' + key.replace('.', '\\.') + '"\\s*:\\s*"([^"]*)"', 'g');
    found[key] = [...src.matchAll(re)].map(m => m[1]);
  }
  check('provider labels are bare engine names in zh and en',
    Object.entries(expected).every(([k, v]) =>
      found[k].length === 2 && found[k].every(x => x === v)) &&
    /\["edge-tts", "Edge TTS", t\("provider\.kind\.online"\)\]/.test(src),
    JSON.stringify(found));
  check('no legacy verbose provider label survives in client source',
    !/自定义音色（RVC）|本地音色（Index-TTS2）|本地克隆（CosyVoice）|Cloud TTS（谷歌付费）|本地音色（GPT-SoVITS）/.test(src) &&
    !/Custom voice \(RVC\)|Local voice \(Index-TTS2\)|Local clone \(CosyVoice\)|Cloud TTS \(Google, paid\)|Local voice \(GPT-SoVITS\)/.test(src),
    'descriptions stay in provider.help.*, not in the label');
}

const failedCount = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} client-load checks passed`);
process.exit(failedCount === 0 ? 0 : 1);
