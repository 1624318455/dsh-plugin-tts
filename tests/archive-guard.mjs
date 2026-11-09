// End-to-end regression test for the archived-session guard.
//
// Scenario reproduced verbatim from the bug report:
//   1. the user clicks "read aloud" on a message in session S
//   2. the user archives session S from the sidebar workspace list
//   3. S disappears from the workspace, but the audio KEPT PLAYING
//
// This drives the REAL client bundle (lib/client.js) in a mocked browser:
//   - a mocked /dsh-tts-api/speak returns an audio URL
//   - the real read-aloud button starts the read
//   - the real guard component (shell.overlay) subscribes to the workspace
//     archive set and must STOP the read when S is archived
//   - the real <audio> element must be paused
//
//   node tests/archive-guard.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ---- minimal React shim (enough for client.js's createElement + hooks) ----
// Hooks are shared across the whole render pass (one tree at a time), and
// useEffect RUNS its callback (the guard's subscription must fire).
let hookCursor = 0;
let hookState = [];
function resetHooks() { hookCursor = 0; hookState = []; }
function useState(init) {
  const i = hookCursor++;
  if (!(i in hookState)) hookState[i] = typeof init === 'function' ? init() : init;
  const set = v => { hookState[i] = typeof v === 'function' ? v(hookState[i]) : v; };
  return [hookState[i], set];
}
const useEffect = (fn) => { hookCursor += 1; if (typeof fn === 'function') fn(); };
const useRef = init => ({ current: init });
const useMemo = fn => fn();
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children, $$node: true }),
  Fragment: Symbol('Fragment'),
  useState: () => { throw new Error('useState outside shim'); },
  useEffect: () => {},
  useRef: () => ({ current: undefined }),
  useMemo: f => f(),
};
// The components were defined against the `react` closure; patch the module
// object so the shim hooks are used, then restore.
function withShim(fn) {
  const orig = { useState: react.useState, useEffect: react.useEffect, useRef: react.useRef, useMemo: react.useMemo };
  react.useState = useState; react.useEffect = useEffect; react.useRef = useRef; react.useMemo = useMemo;
  resetHooks();
  try { return fn(); } finally {
    react.useState = orig.useState; react.useEffect = orig.useEffect; react.useRef = orig.useRef; react.useMemo = orig.useMemo;
  }
}

// ---- browser globals ----
const injectedComponents = [];
const slots = {
  inject(slot, fn) { injectedComponents.push({ slot, fn }); },
  register(spec, component) { return component; },
};
const ctx = {
  get(name) { if (name === 'slots') return slots; return undefined; },
  effect() {}, // no-op: the bundle's style injection needs a real DOM
};
try { Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true }); }
catch (e) { /* already settable */ }

function makeAudioEl() {
  return {
    src: '', playbackRate: 1, currentSrc: '', onended: null, onerror: null,
    playing: false, paused: 0,
    play() { this.playing = true; return Promise.resolve(); },
    pause() { this.playing = false; this.paused++; },
    load() { /* aborts the in-flight decode */ },
    removeAttribute() {}, setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
  };
}
const audioEl = makeAudioEl();
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  AudioContext: function () {}, webkitAudioContext: function () {},
  confirm: () => true,
};
globalThis.document = {
  createElement: () => makeAudioEl(),
  body: { appendChild() {}, removeChild() {} },
  head: { appendChild() {} },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener() {}, removeEventListener() {},
};
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };
const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
};

// The Host synthesis endpoint: returns a playable URL.
globalThis.fetch = async (url) => {
  if (String(url).indexOf('/dsh-tts-api/speak') >= 0) {
    return { ok: true, json: async () => ({ url: '/dsh-tts-audio/test' }) };
  }
  return { ok: true, json: async () => ({ done: true }) };
};

// ---- load the bundle ----
const clientSrc = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'),
  'utf8',
);
globalThis.window.__ModuleLoader__ = {
  load({ factory }) {
    const require_ = name => { if (name === 'react') return react; throw new Error('unknown require: ' + name); };
    factory(require_).apply(ctx);
  },
};
const fn = new Function('window', 'navigator', 'document', 'Audio', clientSrc + '\n;return window.__ModuleLoader__;');
fn(globalThis.window, globalThis.navigator, globalThis.document, globalThis.Audio);

const A = globalThis.window.__dshTtsArchive;
check('archive guard hook exposed', !!A && typeof A.sync === 'function');

const overlayComps = injectedComponents.filter(c => c.slot === 'shell.overlay');
const readButtonComp = injectedComponents.find(c => c.slot === 'conversation.chat.assistant-actions');
check('overlay + read-aloud components registered', overlayComps.length > 0 && !!readButtonComp);

// Mini renderer: resolve one level of function components (the guard returns
// a <TtsArchiveWatcher> element; the shim must render it to fire its effect).
function renderDeep(node) {
  if (!node || !node.$$node) return node;
  if (typeof node.type === 'function') {
    return renderDeep(withShim(() => node.type(node.props)));
  }
  return node;
}
function renderOverlay(archiveSet) {
  const useWorkspaces = sel => sel({ archivedSessionIds: archiveSet });
  return withShim(() =>
    overlayComps.map(({ fn: f }) => renderDeep(f()({ useWorkspaces }))),
  );
}

// ---- 1. mount the audio host so the plugin owns a real <audio> element ----
const overlayNodes = renderOverlay([]);
const audioNode = overlayNodes.find(n => n && n.$$node && n.type === 'audio');
check('audio host renders an <audio> element', !!audioNode);
if (audioNode && typeof audioNode.props.ref === 'function') audioNode.props.ref(audioEl);

// ---- 2. the user starts a read in session "sess-live" ----
const buttonNode = withShim(() => readButtonComp.fn()({
  text: '这是一条正在朗读的消息',
  messageId: 'm1',
  sessionId: 'sess-live',
}));
// The read button is the action button WITHOUT the download modifier class.
const readBtn = (function find(node) {
  if (!node || !node.$$node) return null;
  if (node.props && typeof node.props.className === 'string' &&
      node.props.className.indexOf('dsh-tts-action') >= 0 &&
      node.props.className.indexOf('dsh-tts-action-dl') < 0 &&
      typeof node.props.onClick === 'function') return node;
  for (const c of (node.children || [])) { const hit = find(c); if (hit) return hit; }
  return null;
})(buttonNode);
check('read-aloud button rendered with a click handler', !!readBtn);
if (readBtn) readBtn.props.onClick({ stopPropagation() {} });
await new Promise(r => setTimeout(r, 30));

check('read is speaking', A.speaking() === true, 'speaking=' + A.speaking());
check('read is bound to its session', A.readSessionId() === 'sess-live', 'readSessionId=' + A.readSessionId());
check('audio element is playing', audioEl.playing === true);

// ---- 3. the user archives the session (Host pushes the new archive set) ----
const afterArchive = renderOverlay(['sess-live']);
void afterArchive;

check('archiving the read session STOPS the read', A.speaking() === false, 'speaking=' + A.speaking());
check('archiving the read session PAUSES the audio', audioEl.playing === false, 'playing=' + audioEl.playing);
check('read session binding is cleared after the stop', A.readSessionId() === null,
  'readSessionId=' + A.readSessionId());

// ---- 4. the archived session may not start a NEW read ----
check('archived session refuses a new read', A.canRead('sess-live') === false);
check('a live session still reads', A.canRead('sess-other') === true);
check('session-less read (preview / selection) is never blocked', A.canRead(null) === true);

// ---- 5. the archive set is authoritative (unarchive restores reading) ----
renderOverlay([]);
check('unarchive restores reading', A.canRead('sess-live') === true && A.isArchived('sess-live') === false);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} archive-guard checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
