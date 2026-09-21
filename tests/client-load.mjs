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
const ctx = {
  get(name) { if (name === 'slots') return slots; return undefined; },
  effect() {},
};
try { Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true }); }
catch (e) { /* already settable */ }
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  AudioContext: function(){}, webkitAudioContext: function(){},
  confirm: () => true,
};
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, removeChild(){}, pause(){}, removeAttribute(){}, play: () => Promise.resolve(), addEventListener(){}, removeEventListener(){} }),
  body: { appendChild() {}, removeChild() {} },
  head: { appendChild() {} },
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
      check('settings renders approval voice-alert module', allText(node).includes('事件语音提醒') && allText(node).includes('启用审批语音提醒'), undefined);
      // Entry CTAs removed: provider switch is the only entry (no shortcut cards)
      check('settings hides removed entry CTAs (edge mode)', !allText(node).includes('需要克隆音色') && !allText(node).includes('Index-TTS2 音色'), undefined);
      check('settings shows rawMarkdown toggle', allText(node).includes('朗读原始'), undefined);
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
    // 5) live scroll-follow: continuous ratio + 250ms heartbeat + user yield
    const liveOk = /ttsLiveRatio/.test(src) && /el\.currentTime \/ el\.duration/.test(src) && /chunkStartedAt/.test(src);
    const beatOk = /setInterval\(keepVisible,\s*250\)/.test(src);
    const yieldOk = /ttsUserScrollAt\.t\s*=\s*Date\.now\(\)/.test(src) && /Date\.now\(\) - ttsUserScrollAt\.t < 5000/.test(src);
    check('scroll-follow tracks live ratio', liveOk && beatOk && yieldOk,
      `live=${liveOk} beat=${beatOk} yield=${yieldOk}`);
    // 5b) self-scroll guard: our own scrollTo() must not refresh the user
    // yield window (that froze follow after the first nudge), and the needle
    // must track the live ratio (not the fixed text head).
    const selfOk = /ttsSelfScroll\.on = true/.test(src) && /if \(ttsSelfScroll\.on\) return/.test(src);
    const needleOk = /fullNeedle\.length \* Math\.min\(0\.99/.test(src);
    check('follow not frozen by own scroll + live needle', selfOk && needleOk,
      `self=${selfOk} needle=${needleOk}`);
    // 5c) message anchor: button click climbs to the message root (WeakRef),
    // text-resolved anchors are cached for auto-read reuse.
    const anchorOk = /shared\.readingMsgEl = new WeakRef\(best\)/.test(src) &&
      /shared\.readingMsgEl \? shared\.readingMsgEl\.deref\(\) : null/.test(src);
    check('follow uses anchored message element', anchorOk);
    // 5d) anchor survives re-render (fingerprint relocate) + wrong-element
    // guard (never rubber-band to top on a fragment hit).
    const relocOk = /shared\.readingMsgKey = \{ head/.test(src) && /mark\("relocated"\)/.test(src);
    const guardOk = /mark\("bad-target"\)/.test(src);
    check('anchor relocates + bad target skipped', relocOk && guardOk,
      `reloc=${relocOk} guard=${guardOk}`);
    // 6) compact bar: no "n / total" counter in bar text (tooltip only)
    const noCounter = !/overlay\.reading"\)\) \+ "  " \+ idx/.test(src) && !/\("overlay\.paused"\) : t\("overlay\.reading"\)\) \+/.test(src);
    const pausedOk = /shared\.paused \? t\("overlay\.paused"\) : t\("overlay\.reading"\)(?!\) \+)/.test(src);
    check('bar compact: paused/reading text only, no counter', noCounter && pausedOk,
      `noCounter=${noCounter} pausedOk=${pausedOk}`);
    // 7) box-shadow sentence highlight removed (ugly)
    const noShadowCss = !/\.dsh-tts-sentence-active\{[^}]*box-shadow/.test(src);
    const noAddActive = !/classList\.add\("dsh-tts-sentence-active"\)/.test(src);
    check('sentence shadow highlight removed', noShadowCss && noAddActive,
      `noShadowCss=${noShadowCss} noAddActive=${noAddActive}`);
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
    // 9) fluency trio: skipped-slot advance, stall watchdog + stretch, stalling text
    const skipSlot = /queue\[want\] = false/.test(src) && /queue\[cursor\] === false/.test(src);
    const stallDog = /shared\.stallStretch = true/.test(src) && /0\.85/.test(src) && /chunk\.stalling/.test(src);
    check('skipped chunks advance without gap', skipSlot);
    check('stall watchdog stretches + shows synthesizing', stallDog);
  } catch (e) {
    check('single-file progress regression checks', false, String(e && e.stack || e).slice(0, 200));
  }
}

const failedCount = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} client-load checks passed`);
process.exit(failedCount === 0 ? 0 : 1);
