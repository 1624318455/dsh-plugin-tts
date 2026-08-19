#!/usr/bin/env node
// Generates a standalone UI preview page (tools/ui-preview.html) that loads the
// REAL lib/client.js in a browser, renders the injected components into actual
// DOM using a lightweight React-agnostic renderer, and lets you screenshot it
// for visual verification of the plugin UI (P2-P5).
//
//   node tools/gen-ui-preview.mjs [out.html]
// Then open out.html in a browser (or headless screenshot):
//   npx playwright screenshot tools/ui-preview.html shot.png  (example)
//
// Note: this is a visual-verification aid only, NOT shipped into the plugin.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(path.resolve(here, '..', 'lib', 'client.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

const out = path.resolve(here, process.argv[2] || 'ui-preview.html');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-plugin-tts UI preview</title>
<style>
  :root{
    /* minimal dsh web theme tokens so --dsw-* styles resolve */
    --dsw-alias-label-primary:#eceff3;
    --dsw-alias-label-secondary:#c3c9d1;
    --dsw-alias-label-tertiary:#7f8894;
    --dsw-alias-label-dimmed:#5a6472;
    --dsw-alias-label-inverse:#0f1115;
    --dsw-alias-label-error:#e5484d;
    --dsw-alias-interactive-bg-hover:rgba(255,255,255,.06);
    --dsw-alias-interactive-bg-primary:#3b82f6;
    --dsw-alias-bg-layer-2:#161a20;
    --dsw-alias-bg-layer-3:#1c2128;
    --dsw-alias-border-secondary:rgba(255,255,255,.08);
    --dsw-alias-border-l2:#2a313b;
    --dsw-alias-brand-primary:#3b82f6;
  }
  body{background:#0d0f13;color:var(--dsw-alias-label-primary);font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;padding:24px}
  h2{font-size:13px;color:var(--dsw-alias-label-tertiary);font-weight:600;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.5px}
  .card{background:#14181d;border:1px solid var(--dsw-alias-border-secondary);border-radius:12px;padding:14px;margin-bottom:6px;max-width:640px}
  .toolrow{display:flex;align-items:center;gap:6px;padding:6px 8px;background:#15191f;border:1px solid var(--dsw-alias-border-secondary);border-radius:10px;margin-bottom:8px}
  .toolrow::before{content:"▍";color:var(--dsw-alias-label-dimmed);font-size:13px}
  pre.tip{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:2px 0 0}
</style></head>
<body>
  <h2>1) auto-read pill (off)</h2>
  <div class="toolrow"><div class="slot-input" data-state="off"></div></div>
  <h2>2) auto-read pill (on)</h2>
  <div class="toolrow"><div class="slot-input" data-state="on"></div></div>
  <h2>3) voice settings panel — Edge provider</h2>
  <div class="card"><div class="slot-settings" data-provider="edge"></div></div>
  <h2>4) voice settings panel — RVC provider (onboarding)</h2>
  <div class="card"><div class="slot-settings" data-provider="rvc"></div></div>
  <h2>5) selection-read chip (demo)</h2>
  <div class="card"><button type="button" class="dsh-tts-sel-btn">朗读选中文本</button> <span style="color:var(--dsw-alias-label-tertiary);font-size:11px">← 悬浮在选择旁的“朗读选中”chip（真实交互中由 mouseup 触发）</span></div>

<script>
/* ---------- minimal React-agnostic shim + hooks + DOM renderer ---------- */
let activeHooks = null;
const react = {
  createElement(type, props, ...children){
    const flat=[];
    const push=(x)=>{ if(x==null||x===false||x===true)return; if(Array.isArray(x)){x.forEach(push);return;} flat.push(x); };
    children.forEach(push);
    return {type, props: props||{}, children: flat};
  },
  Fragment: Symbol('frag'),
  useState:i=>activeHooks.useState(i),
  useEffect:(f,d)=>activeHooks.effect(f,d),
  useRef:i=>activeHooks.ref(i),
  useMemo:f=>activeHooks.memo(f),
};
function makeHooks(){
  let c=0; const mem=[];
  return {
    useState(init){ const i=c++; if(!(i in mem)) mem[i]=typeof init==='function'?init():init; return [mem[i],()=>{}]; },
    effect(){ c++; /* do not run component effects (no interaction/nav) */ },
    ref(init){ c++; return {current:init}; },
    memo(f){ c++; try{return f();}catch(e){return undefined;} },
  };
}
function mount(v){
  if(v==null||typeof v==='boolean') return null;
  if(typeof v==='string'||typeof v==='number') return document.createTextNode(String(v));
  if(v.type===react.Fragment){ const f=document.createDocumentFragment(); (v.children||[]).forEach(c=>{const n=mount(c);if(n)f.appendChild(n);}); return f; }
  if(typeof v.type==='function'){ activeHooks=makeHooks(); const n=mount(v.type(v.props) ); activeHooks=null; return n; }
  const el=document.createElement(v.type);
  const p=v.props||{};
  for(const k in p){
    const val=p[k];
    if(k==='children'||k==='key'||k==='ref') continue;
    if(typeof val==='function') continue; // handlers ignored for static render
    if(k==='className'){ el.setAttribute('class', val); }
    else if(k==='style'&&val&&typeof val==='object'){ for(const sk in val){ try{ el.style[sk]=val[sk]; }catch(e){} } }
    else if(k==='value'){ try{ el.value=val; }catch(e){ el.setAttribute('value',val); } }
    else if(k==='disabled'){ if(val) el.setAttribute('disabled',''); }
    else { try{ el.setAttribute(k, val); }catch(e){} }
  }
  (v.children||[]).forEach(c=>{ const n=mount(c); if(n)el.appendChild(n); });
  return el;
}
/* ---------- slots / ctx (mirrors client-load) ---------- */
const injectedComponents=[];
const slots={
  inject(slot,fn){ injectedComponents.push({slot,fn}); },
  register(spec,component){ return component; },
};
const ctx={ get(n){ return n==='slots'?slots:undefined; }, effect(fn){ try{ fn(); }catch(e){} } };

/* ---------- load client bundle once; we'll re-eval per state ---------- */
const CLIENT = ${JSON.stringify(clientSrc)};
function evalClient(){
  injectedComponents.length=0;
  window.__ModuleLoader__={
    load({factory}){
      const require_=name=>{ if(name==='react') return react; throw new Error('unknown require '+name); };
      const mod=factory(require_);
      if(!mod||!mod.apply) throw new Error('no apply');
      mod.apply(ctx);
    },
  };
  const fn=new Function('window','navigator','document','Audio', CLIENT + '\\n;return window.__ModuleLoader__;');
  fn(window,navigator,document,Audio);
}
function seedSettings(obj){
  if(obj) localStorage.setItem('dsh-tts-settings', JSON.stringify(obj));
  else localStorage.removeItem('dsh-tts-settings');
}
function renderSlot(slotName, container){
  try{
    const c=injectedComponents.find(x=>x.slot===slotName);
    if(!c) throw new Error('no component for '+slotName);
    const comp=c.fn();
    if(typeof comp!=='function') throw new Error(slotName+' fn did not return component');
    activeHooks=makeHooks();
    const node=comp({ session:null, sessionId:'s1', useSession:s=>s({nodes:[]}), messageId:'m1' });
    const dom=mount(node);
    activeHooks=null;
    if(dom) container.appendChild(dom);
  }catch(e){
    logErr(slotName+': '+ (e&&e.stack||e));
  }
}
function logErr(msg){
  const el=document.createElement('pre');
  el.style.cssText='color:#e5484d;font-size:11px;white-space:pre-wrap';
  el.textContent=msg;
  document.body.appendChild(el);
}

/* off */
seedSettings({autoRead:false, provider:'edge-tts', voice:'zh-CN-XiaoxuanNeural'});
evalClient(); renderSlot('conversation.input.left', document.querySelector('.slot-input[data-state=off]'));

/* on */
seedSettings({autoRead:true, provider:'edge-tts', voice:'zh-CN-YunyangNeural'});
evalClient(); renderSlot('conversation.input.left', document.querySelector('.slot-input[data-state=on]'));

/* settings edge */
seedSettings({autoRead:false, provider:'edge-tts', voice:'zh-CN-XiaoxuanNeural'});
evalClient(); renderSlot('settings.plugins.tab', document.querySelector('.slot-settings[data-provider=edge]'));

/* settings rvc (shows onboarding) */
seedSettings({autoRead:false, provider:'rvc', voice:'zh-CN-XiaoxuanNeural', rvc:{model:'C:/rvc/model.pth',index:'C:/rvc/model.index',f0UpKey:-2,indexRate:0.75,protect:0.33}});
evalClient(); renderSlot('settings.plugins.tab', document.querySelector('.slot-settings[data-provider=rvc]'));
</script>
</body></html>
`;

writeFileSync(out, html, 'utf8');
console.log('wrote', out);
