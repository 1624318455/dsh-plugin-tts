// Guards the idle audio release added for issue #11 (Windows never idling to
// sleep because the plugin kept a system audio endpoint open after a read).
//   node tests/audio-release.mjs
//
// The unlock path is exercised for REAL: client.js is loaded into a mocked
// browser env, its autoplay-unlock effect is executed, a user gesture is
// simulated, and the fake AudioContext records resume()/suspend(). The three
// natural-end paths (chunked finish(), <audio> onended, chunk-fallback
// finally) need a live Host to reach, so they are asserted structurally
// against the shipped source — cheap insurance that nobody deletes the
// release calls again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ---- fake AudioContext: records the park/unpark calls (#11) ----
const acInstances = [];
class FakeAC {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = { name: 'dest' };
    this.calls = [];
    acInstances.push(this);
  }
  resume() {
    this.calls.push('resume');
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.calls.push('suspend');
    this.state = 'suspended';
    return Promise.resolve();
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {}, stop() {}, onended: null, playbackRate: { value: 1 } };
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 1 });
  }
}

// ---- fake DOM: records attribute releases ----
const createdEls = [];
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    attrs: {},
    calls: [],
    parentNode: null,
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { this.attrs[k] = undefined; delete this.attrs[k]; this.calls.push('removeAttribute:' + k); },
    load() { this.calls.push('load'); },
    pause() { this.calls.push('pause'); },
    play() { this.calls.push('play'); return Promise.resolve(); },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
  };
  createdEls.push(el);
  return el;
}

const docListeners = new Map();
const styleSheets = [];

globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  AudioContext: FakeAC,
  webkitAudioContext: undefined,
  confirm: () => true,
};
try {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
} catch (e) {}

const bodyEl = {
  appendChild(el) { el.parentNode = bodyEl; },
  removeChild(el) { el.parentNode = null; },
};
globalThis.document = {
  createElement(tag) {
    const el = makeEl(tag);
    if (el.tagName === 'STYLE') styleSheets.push(el);
    return el;
  },
  body: bodyEl,
  head: { appendChild() {}, removeChild() {} },
  addEventListener(ev, fn) { docListeners.set(ev, fn); },
  removeEventListener(ev) { docListeners.delete(ev); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  getElementById() { return null; },
};
globalThis.Audio = function () {
  this.play = () => Promise.resolve();
  this.pause = () => {};
  this.setAttribute = () => {};
  this.removeAttribute = () => {};
};

const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};

// ---- minimal React shim (client.js imports react) ----
const react = {
  createElement(type, props, ...children) { return { type, props: props || {}, children, $$node: true }; },
  Fragment: Symbol('Fragment'),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: undefined }),
  useMemo: (f) => f(),
  useCallback: (f) => f,
  useLayoutEffect: () => {},
};

// ---- host ctx: run ONLY the effects we need ----
const ranEffects = [];
const slots = {
  inject(slot, fn) { /* components are not rendered in this test */ },
  register(spec, component) { return component; },
  specDynamic() { return undefined; },
};
const ctx = {
  get(name) { return name === 'slots' ? slots : undefined; },
  effect(fn, label) {
    const tag = String(label || '');
    ranEffects.push(tag);
    // The autoplay unlock is the path under test; styles is pure DOM building
    // that other suites already cover.
    if (tag.includes('autoplay unlock') || tag.endsWith(': styles')) {
      try { fn(); } catch (e) { /* surfaced by the load check below */ }
    }
  },
  on() {},
  emit() {},
};

// ---- load the real bundle ----
const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');
globalThis.window.__ModuleLoader__ = {
  load({ factory }) {
    const mod = factory((name) => {
      if (name === 'react') return react;
      throw new Error('unknown require: ' + name);
    });
    if (!mod || !mod.apply) throw new Error('factory did not export apply');
    mod.apply(ctx);
  },
};

let loaded = false;
try {
  const fn = new Function('window', 'navigator', 'document', 'Audio', clientSrc + '\n;return window.__ModuleLoader__;');
  fn(globalThis.window, globalThis.navigator, globalThis.document, globalThis.Audio);
  loaded = true;
} catch (e) {
  check('client.js loads and apply() runs', false, String((e && e.message) || e));
}
check('client.js loads and apply() runs', loaded, `${ranEffects.length} effect(s) registered`);

// ---- the unlock effect must have hooked user gestures ----
check('autoplay unlock effect ran', ranEffects.some((l) => l.includes('autoplay unlock')), ranEffects.join(' | '));
const gestureHandler = docListeners.get('pointerdown');
check('unlock listens for pointerdown', typeof gestureHandler === 'function');

if (typeof gestureHandler === 'function') {
  // ---- simulate the first user gesture ----
  gestureHandler();
  const ac = acInstances[0];
  check('gesture creates exactly one shared AudioContext', acInstances.length === 1, `instances=${acInstances.length}`);
  check('gesture resumes the context (autoplay unlocked)', !!ac && ac.state === 'running', ac && ac.state);
  const unlockEl = createdEls.find((el) => el.tagName === 'AUDIO' && el.attrs && el.attrs.src && String(el.attrs.src).startsWith('data:audio/wav'));
  check('silent unlock element was created and played', !!unlockEl && unlockEl.calls.includes('play'), unlockEl ? unlockEl.calls.join(',') : 'not created');
  check('unlocked immediately — no suspend before the grace window', !!ac && !ac.calls.includes('suspend'), ac && ac.calls.join(','));

  // ---- after the idle grace window the clock must be parked + element released ----
  await new Promise((r) => setTimeout(r, 1750));
  check('idle AudioContext is suspended after grace window (core #11 fix)', !!ac && ac.state === 'suspended', ac && `${ac.state} calls=${ac.calls.join(',')}`);
  check('suspend() was actually called once', !!ac && ac.calls.filter((c) => c === 'suspend').length === 1, ac && ac.calls.join(','));
  check(
    'silent unlock element releases its src',
    !!unlockEl && unlockEl.calls.includes('removeAttribute:src') && unlockEl.calls.includes('load'),
    unlockEl ? unlockEl.calls.join(',') : 'missing',
  );
  check('silent unlock element is detached from the DOM', !!unlockEl && unlockEl.parentNode === null);
}

// ---- structural guards for the paths a live Host is needed to reach ----
const src = clientSrc;
const finishBlock = src.slice(src.indexOf('const finish = () => {'), src.indexOf('const finish = () => {') + 700);
check(
  'chunked finish() parks the clock after a natural end',
  /clearSpeaking\(token\);[\s\S]{0,400}suspendIdleAudioContext\(\);/.test(finishBlock),
  finishBlock.includes('suspendIdleAudioContext()') ? 'present' : 'MISSING',
);

const onendedBlock = src.slice(src.indexOf('const releaseAudioEl = () => {'), src.indexOf('const releaseAudioEl = () => {') + 900);
check(
  'single-URL onended/onerror release the <audio> element',
  /releaseAudioEl\(\);/g.test(onendedBlock) &&
    (onendedBlock.match(/releaseAudioEl\(\);/g) || []).length >= 2 &&
    /removeAttribute\("src"\)/.test(onendedBlock),
  `${(onendedBlock.match(/releaseAudioEl\(\);/g) || []).length} call(s)`,
);

const fallbackFinally = src.slice(src.indexOf('const chainAlive = token === shared.speakToken'), src.indexOf('const chainAlive = token === shared.speakToken') + 700);
check(
  'chunk-fallback finally releases the last-played element (cur)',
  /if \(chainAlive\) \{[\s\S]{0,300}cur\.removeAttribute\("src"\)/.test(fallbackFinally),
  fallbackFinally.includes('cur.removeAttribute("src")') ? 'present' : 'MISSING',
);

check(
  'idle suspend never fires under an active read or live chain',
  /if \(shared\.speaking \|\| shared\.waCleanup \|\| shared\.paused\) return;/.test(src),
);

check(
  'playChunks resumes unconditionally (pending suspend cannot freeze a read)',
  /await ctx\.resume\(\);[\s\S]{0,400}if \(stale\(\)\) return;/.test(src) &&
    !/if \(ctx\.state === "suspended"\) \{\s*try \{\s*await ctx\.resume\(\)/.test(src),
);

// ---- report ----
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} audio-release checks passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed) process.exitCode = 1;
