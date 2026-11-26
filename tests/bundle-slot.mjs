// Host-slot compatibility for the voice settings panel (issue #9).
//
// Three shells are simulated: the standard one that declares
// `settings.plugins.tab`, the DSH NEXT one that declares only
// `plugins.bundle.config`, and a hostile one whose `slots.inject` throws on an
// unknown slot name. The panel must be reachable in the first two, appear
// exactly once when a shell declares both, and never take client boot down.
//   node tests/bundle-slot.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const clientSrc = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'),
  'utf8',
);
const PKG = '@memef1f1y/dsh-plugin-tts';

// ---- minimal React shim: enough for the panel's createElement + hooks ----
function makeReact() {
  return {
    createElement(type, props, ...children) {
      if (type === Symbol.for('Fragment')) return { type, props: props || {}, children };
      return { type, props: props || {}, children, $$node: true };
    },
    Fragment: Symbol.for('Fragment'),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: fn => fn,
    useRef: init => ({ current: init }),
    useMemo: fn => fn(),
  };
}

// ---- boot the bundle against a given slots service ----
// Returns { injected, comps, error } where comps maps slot -> component.
function boot(slots) {
  const injected = [];
  const react = makeReact();
  const win = {
    addEventListener() {}, removeEventListener() {},
    AudioContext: function () {}, webkitAudioContext: function () {},
    confirm: () => true,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  const doc = {
    createElement: tag => {
      const el = {
        tagName: String(tag).toUpperCase(), dataset: {}, style: {},
        setAttribute() {}, removeAttribute() {}, appendChild() {}, removeChild() {},
        pause() {}, play: () => Promise.resolve(),
        addEventListener() {}, removeEventListener() {},
        querySelectorAll: () => [], querySelector: () => null,
      };
      return el;
    },
    body: { appendChild() {}, removeChild() {}, querySelectorAll: () => [] },
    head: { appendChild() {}, removeChild() {} },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {}, removeEventListener() {},
  };
  const store = new Map();
  const ctx = {
    slots,
    get(name) { return name === 'slots' ? slots : undefined; },
    effect(fn) { /* styles/effects are not the subject of this test */ },
  };
  const loader = {
    load({ factory }) {
      const mod = factory(name => {
        if (name === 'react') return react;
        throw new Error('unknown require: ' + name);
      });
      mod.apply(ctx);
    },
  };
  win.__ModuleLoader__ = loader;
  let error = null;
  try {
    const fn = new Function(
      'window', 'navigator', 'document', 'Audio', 'localStorage',
      'globalThis.window = window;\nglobalThis.document = document;\nglobalThis.localStorage = localStorage;\n'
      + clientSrc + '\n;return window.__ModuleLoader__;',
    );
    fn(win, { language: 'zh-CN' }, doc, function () {}, {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    });
  } catch (e) {
    error = e;
  }
  return { injected, error };
}

// Slots service stub. `declared` lists slot names the fake shell declares.
function makeSlots(declared, opts = {}) {
  const comps = new Map();
  const specs = new Map();
  return {
    specDynamic(key) {
      return declared.includes(key) ? { name: key, kind: 'list' } : undefined;
    },
    declarationEpoch(key) {
      return declared.includes(key) ? 1 : 0;
    },
    inject(name, factory) {
      if (opts.throwOn && opts.throwOn.includes(name)) {
        throw new Error('unknown slot: ' + name);
      }
      comps.set(name, factory);
    },
    register(spec, component) {
      specs.set(spec.name + ':' + (spec.id ?? spec.key ?? ''), spec);
      return component;
    },
    _factories: comps,
    _specs: specs,
  };
}

// Resolve the component a shell would render for a slot.
function componentFor(slots, slot) {
  const factory = slots._factories.get(slot);
  if (!factory) return undefined;
  const el = factory();
  return el;
}

// ---- scenario A: standard shell (settings tab declared, no bundle slot) ----
{
  const slots = makeSlots(['settings.plugins.tab']);
  const { error } = boot(slots);
  check('A standard shell: apply() completes', !error, error && String(error.message));
  const tabComp = componentFor(slots, 'settings.plugins.tab');
  check('A standard shell: settings tab still registered', typeof tabComp === 'function');
  const bundleFactory = slots._factories.get('plugins.bundle.config');
  check('A standard shell: bundle factory registered without throwing', typeof bundleFactory === 'function');
  if (typeof bundleFactory === 'function') {
    const bundleComp = bundleFactory();
    let rendered = 'threw';
    try { rendered = bundleComp({}); } catch (e) { rendered = 'threw:' + e.message; }
    check('A standard shell: bundle card renders nothing (no duplicate panel)',
      rendered === null, 'got ' + (rendered === null ? 'null' : typeof rendered));
  }
}

// ---- scenario B: DSH NEXT (no settings tab, bundle config declared) ----
{
  const slots = makeSlots(['plugins.bundle.config']);
  const { error } = boot(slots);
  check('B NEXT shell: apply() completes', !error, error && String(error.message));
  const tabFactory = slots._factories.get('settings.plugins.tab');
  check('B NEXT shell: tab registration is still attempted (harmless no-op)', typeof tabFactory === 'function');
  const bundleFactory = slots._factories.get('plugins.bundle.config');
  check('B NEXT shell: bundle factory registered', typeof bundleFactory === 'function');
  if (typeof bundleFactory === 'function') {
    const bundleComp = bundleFactory();
    let rendered = 'threw';
    try { rendered = bundleComp({}); } catch (e) { rendered = 'threw:' + e.message; }
    const isPanel = !!rendered && typeof rendered === 'object' && rendered.$$node === true
      && typeof rendered.type === 'function';
    check('B NEXT shell: panel renders instead of null (issue #9 fixed)', isPanel,
      rendered === null ? 'got null — panel still unreachable' : 'panel node rendered');
    // The component must survive a real render pass, not just be non-null.
    if (isPanel) {
      let renderError = null;
      try { rendered.type(rendered.props); } catch (e) { renderError = e; }
      check('B NEXT shell: panel body executes without throwing', !renderError,
        renderError && String(renderError.message));
    }
  }
}

// ---- scenario C: shell declaring BOTH slots ----
{
  const slots = makeSlots(['settings.plugins.tab', 'plugins.bundle.config']);
  const { error } = boot(slots);
  check('C both slots: apply() completes', !error, error && String(error.message));
  const bundleFactory = slots._factories.get('plugins.bundle.config');
  if (typeof bundleFactory === 'function') {
    const bundleComp = bundleFactory();
    const rendered = bundleComp({});
    check('C both slots: exactly one panel (bundle copy suppresses itself)',
      rendered === null, 'got ' + (rendered === null ? 'null' : 'second panel'));
  } else {
    check('C both slots: exactly one panel (bundle copy suppresses itself)', false, 'factory missing');
  }
}

// ---- scenario D: hostile service that throws on an unknown slot name ----
// Registering a slot this shell does not know must never abort client boot.
{
  const slots = makeSlots([], { throwOn: ['plugins.bundle.config'] });
  const { error } = boot(slots);
  check('D hostile shell: bundle-slot throw is contained, apply() survives', !error,
    error && ('apply threw: ' + error.message));
}

// ---- scenario E: pre-0.2.2 service with no spec probe at all ----
// Older hosts expose neither specDynamic nor declarationEpoch; the gate must
// fall back to rendering rather than hiding the panel behind a TypeError.
{
  const slots = makeSlots(['plugins.bundle.config']);
  delete slots.specDynamic;
  delete slots.declarationEpoch;
  const { error } = boot(slots);
  check('E legacy service: apply() completes', !error, error && String(error.message));
  const bundleFactory = slots._factories.get('plugins.bundle.config');
  if (typeof bundleFactory === 'function') {
    let rendered = 'threw';
    try { rendered = bundleFactory()({}); } catch (e) { rendered = 'threw:' + e.message; }
    check('E legacy service: panel still renders (gate degrades open)',
      !!rendered && typeof rendered === 'object' && rendered.$$node === true, 'panel node rendered');
  } else {
    check('E legacy service: panel still renders (gate degrades open)', false, 'factory missing');
  }
}

// ---- scenario F: top-level settings page (new shells, no plugins tab) ----
// dsh 0.2.2-rc.x has no `settings.plugins.tab`; the panel must land at the
// first level of the Settings dialog, right after "Agent presets" (order 20).
{
  const slots = makeSlots(['settings.section', 'plugins.bundle.config']);
  const { error } = boot(slots);
  check('F new shell: apply() completes', !error, error && String(error.message));
  const factory = slots._factories.get('settings.section');
  check('F new shell: settings.section registration attempted', typeof factory === 'function');
  if (typeof factory === 'function') {
    const comp = factory();
    const spec = slots._specs.get('settings.section:tts');
    check('F new shell: section uses id "tts"', !!spec, 'id=' + (spec ? spec.id : 'missing'));
    check('F new shell: section order 25 (after Agent presets, before market)',
      !!spec && spec.order === 25, spec && 'order=' + spec.order);
    check('F new shell: section label is localized', !!spec && typeof spec.label === 'function'
      && spec.label() === 'dsh-plugin-tts', spec && 'label=' + (typeof spec.label === 'function' ? spec.label() : spec.label));
    let rendered = 'threw';
    try { rendered = comp({ close() {} }); } catch (e) { rendered = 'threw:' + e.message; }
    check('F new shell: section renders the voice panel',
      !!rendered && typeof rendered === 'object' && rendered.$$node === true,
      rendered === 'threw' ? 'render threw' : 'panel node rendered');
  }
}

// ---- scenario G: standard shell keeps exactly one entry (no section) ----
{
  const slots = makeSlots(['settings.plugins.tab', 'settings.section']);
  const { error } = boot(slots);
  check('G standard shell: apply() completes', !error, error && String(error.message));
  check('G standard shell: no duplicate top-level section registered',
    !slots._factories.has('settings.section'),
    slots._factories.has('settings.section') ? 'section registered as well as the tab' : 'tab only');
}

const failedCount = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} bundle-slot checks passed`);
process.exit(failedCount === 0 ? 0 : 1);
