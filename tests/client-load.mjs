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
      mod.apply(ctx);
    },
  };
  // evaluate client.js in this context
  const fn = new Function('window', 'navigator', 'document', 'Audio', clientSrc + '\n;return window.__ModuleLoader__;');
  const ml = fn(globalThis.window, globalThis.navigator, globalThis.document, globalThis.Audio);
  check('client.js loads + apply() runs', injectedComponents.length > 0, `${injectedComponents.length} slot(s) injected`);
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
      check(`render ${slot}`, !!node, undefined);
    } catch (e) {
      check(`render ${slot}`, false, String(e && e.stack || e).slice(0, 200));
    }
  }
}

const failedCount = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} client-load checks passed`);
process.exit(failedCount === 0 ? 0 : 1);
