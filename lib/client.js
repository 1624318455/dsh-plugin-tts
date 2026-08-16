// @dsh-external/dsh-plugin-tts — Client half (browser bundle).
// Hand-written in the harness module-loader format; `require` answers the
// platform externals (react), everything else is inlined.
window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-plugin-tts",
  factory: require => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    const apply = ctx => {
      const slots = ctx.get("slots");
      if (!slots) return;

      // ---------- shared state & audio control ----------
      const shared = {
        autoRead: false,
        voice: "zh-CN-XiaoxuanNeural",
        provider: "edge-tts",
        rvc: {
          baseUrl: "http://127.0.0.1:4892",
          model: "",
          index: "",
          baseSource: "edge",
          baseAudioName: "",
          baseAudioData: "",
          baseVoice: "zh-CN-YunyangNeural",
          baseRate: 0,
          basePitch: 0,
          baseVolume: 0,
          spkId: 0,
          f0File: "",
          f0Method: "rmvpe",
          indexRate: 0.75,
          f0UpKey: 0,
          resampleSr: 40000,
          rmsMixRate: 0.25,
          protect: 0.33,
          filterRadius: 3,
        },
        speaking: false,
        currentText: null,
        speakSource: null,
        speakToken: 0,
        chunkProgress: null, // { index: 1-based chunk now playing, total } during chunked playback
        audioEl: null,
        spareAudioEl: null, // second <audio> used for ping-pong chunk playback (fallback)
        audioCtx: null,     // shared Web Audio context (chunked playback)
        waCleanup: null,    // stop() the active Web Audio chain
        lastSeqBySession: new Map(),
      };
      const listeners = new Set();
      function notify() {
        for (const fn of listeners) {
          try {
            fn();
          } catch (e) {}
        }
      }
      function useSharedForce() {
        const [, setN] = react.useState(0);
        react.useEffect(() => {
          const fn = () => setN(n => n + 1);
          listeners.add(fn);
          return () => listeners.delete(fn);
        }, []);
      }

      function plainText(text) {
        return String(text || "")
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/`([^`]*)`/g, "$1")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/__([^_]+)__/g, "$1")
          .replace(/~~([^~]+)~~/g, "$1")
          .replace(/^\s*[-*+]\s+/gm, "")
          .replace(/^\s*\d+\.\s+/gm, "")
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\n\s*/g, " ")
          .trim();
      }

      function extractText(blocks) {
        let text = "";
        if (blocks) {
          for (const b of blocks) {
            if (b && b.kind === "text" && typeof b.text === "string")
              text += (text ? "\n" : "") + b.text;
          }
        }
        return text;
      }

      function clearSpeaking(token) {
        if (token === shared.speakToken) {
          shared.speaking = false;
          shared.currentText = null;
          shared.speakSource = null;
          shared.chunkProgress = null;
          notify();
        }
      }

      function stopSpeaking() {
        shared.speakToken += 1;
        shared.speaking = false;
        shared.currentText = null;
        shared.speakSource = null;
        shared.chunkProgress = null;
        const el = shared.audioEl;
        if (el) {
          try {
            el.pause();
          } catch (e) {}
          try {
            el.removeAttribute("src");
          } catch (e) {}
        }
        const el2 = shared.spareAudioEl;
        if (el2) {
          try {
            el2.pause();
          } catch (e) {}
          try {
            el2.removeAttribute("src");
          } catch (e) {}
        }
        if (shared.waCleanup) {
          try {
            shared.waCleanup();
          } catch (e) {}
          shared.waCleanup = null;
        }
        notify();
      }

      function stopIfSource(source) {
        if (shared.speakSource === source) stopSpeaking();
      }

      async function rpcSpeak(text, voice) {
        const payload = { text, voice, provider: shared.provider };
        const pct = v =>
          v === 0 ? "default" : (v > 0 ? "+" : "") + v + "%";
        if (shared.provider === "rvc") {
          const r = shared.rvc;
          const custom = Object.assign({}, r, {
            baseRate: pct(r.baseRate),
            basePitch: pct(r.basePitch),
            baseVolume: pct(r.baseVolume),
          });
          if (r.baseSource !== "upload") {
            custom.baseAudioBase64 = "";
            custom.baseAudioName = "";
          }
          payload.custom = custom;
        } else {
          payload.prosody = {
            rate: pct(shared.rvc.baseRate),
            pitch: pct(shared.rvc.basePitch),
            volume: pct(shared.rvc.baseVolume),
          };
        }
        const response = await fetch("/dsh-tts-api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return await response.json();
      }

      async function fetchNextChunk(jobId, token) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 200000);
        try {
          const r = await fetch(
            "/dsh-tts-api/rvc-next?job=" + encodeURIComponent(jobId),
            { signal: ctrl.signal },
          );
          return await r.json().catch(() => ({ done: true }));
        } catch (e) {
          return { done: true, error: String((e && e.message) || e) };
        } finally {
          clearTimeout(timer);
        }
      }

      // Web Audio chunk player: decodes each chunk into an AudioBuffer and
      // schedules the sources back-to-back on the sample clock
      // (start(prevEnd) — sample-accurate, gapless by construction). The server
      // already trims per-chunk edge silence; decoding stays 2 buffers ahead so
      // the chain never falls behind.
      async function playChunks(jobId, initialUrls, total, token, onError) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return playChunksAudio(jobId, initialUrls, total, token, onError);
        let ctx = shared.audioCtx;
        if (!ctx) {
          try {
            ctx = shared.audioCtx = new AC();
          } catch (e) {
            return playChunksAudio(jobId, initialUrls, total, token, onError);
          }
        }
        if (ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch (e) { /* keep going; start() clamps to currentTime */ }
        }
        const queue = initialUrls.slice();
        let cursor = 0;       // next queue index to decode
        let completed = false; // host reported no more chunks
        let inFlight = null;
        let nextStart = ctx.currentTime + 0.05; // schedule cursor (sample clock)
        let decoded = 0;      // sources scheduled
        let played = 0;       // sources that ended
        let finished = false;
        const sources = new Set();
        let master = null;
        try {
          master = ctx.createGain();
          master.connect(ctx.destination);
        } catch (e) {
          return playChunksAudio(jobId, initialUrls, total, token, onError);
        }
        const setProgress = index => {
          shared.chunkProgress = { index: Math.min(index, total), total };
          notify();
        };
        const requestNext = () => {
          if (completed || inFlight) return;
          inFlight = fetchNextChunk(jobId, token)
            .then(r => {
              inFlight = null;
              if (token !== shared.speakToken) return;
              if (r && r.url) queue.push(r.url);
              else if (r && r.error) {
                completed = true;
                if (typeof onError === "function") onError("后续段落合成失败：" + r.error);
              } else {
                completed = true;
              }
            })
            .catch(() => {
              inFlight = null;
              completed = true;
            });
        };
        const decode = async url => {
          const r = await fetch(url);
          if (!r.ok) throw new Error("HTTP " + r.status);
          return await ctx.decodeAudioData(await r.arrayBuffer());
        };
        const schedule = buf => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(master);
          src.start(nextStart);
          nextStart += buf.duration;
          sources.add(src);
          const k = decoded;
          src.onended = () => {
            sources.delete(src);
            if (token !== shared.speakToken) return;
            played++;
            setProgress(k + 2);
            if (played >= total) finish();
          };
          decoded++;
        };
        const cleanup = () => {
          for (const s of sources) {
            try {
              s.stop();
            } catch (e) {}
          }
          sources.clear();
          try {
            master.disconnect();
          } catch (e) {}
        };
        const finish = () => {
          if (finished) return;
          finished = true;
          if (shared.waCleanup === cleanup) shared.waCleanup = null;
          cleanup();
          if (token === shared.speakToken) clearSpeaking(token);
        };
        shared.waCleanup = () => {
          if (finished) return;
          finished = true;
          if (shared.waCleanup === cleanup) shared.waCleanup = null;
          cleanup();
        };
        try {
          setProgress(1);
          while (token === shared.speakToken && !finished) {
            if (queue.length - cursor >= 2) requestNext(); // top up URL queue
            if (cursor < queue.length && decoded - played < 2) {
              const url = queue[cursor++];
              try {
                const buf = await decode(url);
                if (token !== shared.speakToken) break;
                schedule(buf);
              } catch (e) {
                if (typeof onError === "function")
                  onError("音频解码失败：" + String((e && e.message) || e));
                break;
              }
              continue;
            }
            requestNext();
            await new Promise(r => setTimeout(r, 200));
          }
        } finally {
          finish();
        }
      }

      // Fallback chunk player (no Web Audio): two <audio> elements ping-pong;
      // the next chunk's data preloads during the current chunk's playback.
      async function playChunksAudio(jobId, initialUrls, total, token, onError) {
        const elA = shared.audioEl;
        const elB = document.createElement("audio");
        elB.preload = "auto";
        elB.style.display = "none";
        document.body.appendChild(elB);
        shared.spareAudioEl = elB;
        const queue = initialUrls.slice();
        let cursor = 0;
        let completed = false; // host reported no more chunks
        let inFlight = null;
        let cur = elA;
        let spare = elB;
        const setProgress = index => {
          shared.chunkProgress = { index, total };
          notify();
        };
        const requestNext = () => {
          if (completed || inFlight) return;
          inFlight = fetchNextChunk(jobId, token)
            .then(r => {
              inFlight = null;
              if (token !== shared.speakToken) return;
              if (r && r.url) queue.push(r.url);
              else if (r && r.error) {
                completed = true;
                if (typeof onError === "function") onError("后续段落合成失败：" + r.error);
              } else {
                completed = true;
              }
            })
            .catch(() => {
              inFlight = null;
              completed = true;
            });
        };
        const playOne = (url, index) =>
          new Promise(resolve => {
            if (token !== shared.speakToken) return resolve();
            setProgress(index);
            let done = false;
            const fin = () => {
              if (done) return;
              done = true;
              cur.onended = null;
              cur.onerror = null;
              resolve();
            };
            cur.onended = fin;
            cur.onerror = () => {
              fin();
              if (typeof onError === "function") onError("某段音频加载失败，已跳过");
            };
            if (cur.getAttribute("src") !== url) {
              cur.src = url;
              cur.load();
            }
            cur.play().catch(fin);
          });
        try {
          while (token === shared.speakToken) {
            if (queue.length - cursor >= 2) requestNext(); // top up while comfortably buffered
            if (cursor < queue.length) {
              const url = queue[cursor];
              const after = queue[cursor + 1];
              // preload the NEXT chunk's audio into the spare element while the
              // current chunk plays (full chunk-duration of lead time)
              if (after && spare.getAttribute("src") !== after) {
                spare.src = after;
                spare.load();
              }
              await playOne(url, cursor + 1);
              // swap: the buffered spare becomes the player; the just-finished
              // element becomes the next preload target
              const t = cur;
              cur = spare;
              spare = t;
              cursor++;
              continue;
            }
            requestNext();
            if (!inFlight) break; // nothing buffered, nothing coming
            await new Promise(r => setTimeout(r, 200));
          }
        } finally {
          if (token === shared.speakToken) clearSpeaking(token);
          try { elB.pause(); } catch (e) {}
          try { elB.removeAttribute("src"); } catch (e) {}
          try { document.body.removeChild(elB); } catch (e) {}
          shared.spareAudioEl = null;
        }
      }

      async function speakText(rawText, source, onError) {
        const trimmed = plainText(rawText);
        if (!trimmed) return { ok: false, error: "empty text" };
        if (shared.speaking && shared.currentText === trimmed) {
          stopSpeaking();
          return { ok: true, stopped: true };
        }
        stopSpeaking();
        const token = ++shared.speakToken;
        shared.speaking = true;
        shared.currentText = trimmed;
        shared.speakSource = source || "manual";
        notify();
        try {
          const result = await rpcSpeak(trimmed, shared.voice);
          if (token !== shared.speakToken)
            return { ok: false, error: "interrupted" };
          if (!result || result.error) {
            clearSpeaking(token);
            console.error("[tts] synthesize failed:", result && result.error);
            return {
              ok: false,
              error: String((result && result.error) || "语音合成失败"),
            };
          }
          const el = shared.audioEl;
          if (!el) {
            clearSpeaking(token);
            return { ok: false, error: "audio unavailable" };
          }
          // Long RVC read -> chunked progressive playback queue.
          if (Array.isArray(result.chunks) && result.chunks.length) {
            const total = result.total || result.chunks.length;
            shared.chunkProgress = { index: 1, total };
            notify();
            playChunks(result.jobId, result.chunks, total, token, onError);
            return { ok: true, chunked: true, total };
          }
          el.onended = () => clearSpeaking(token);
          el.onerror = () => {
            clearSpeaking(token);
            if (typeof onError === "function") onError("音频加载失败，请重试");
          };
          el.src = result.url;
          try {
            await el.play();
          } catch (e) {
            clearSpeaking(token);
            console.error("[tts] play failed:", String(e));
            return { ok: false, error: String((e && e.message) || e) };
          }
          return { ok: true };
        } catch (e) {
          console.error("[tts] rpc failed:", String(e));
          clearSpeaking(token);
          return { ok: false, error: String((e && e.message) || e) };
        }
      }

      // ---------- icons ----------
      function SpeakerIcon() {
        return react.createElement(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 16,
            height: 16,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.2,
            "aria-hidden": true,
          },
          react.createElement("path", {
            d: "M2.5 6v4h2.5L8 12.5v-9L5 6H2.5z",
            fill: "currentColor",
            stroke: "none",
          }),
          react.createElement("path", { d: "M10 6.2a3 3 0 0 1 0 3.6" }),
          react.createElement("path", { d: "M11.4 4.6a5 5 0 0 1 0 6.8" }),
        );
      }
      function EqualizerIcon() {
        return react.createElement(
          "span",
          { className: "dsh-tts-eq", "aria-hidden": true },
          react.createElement("span", { className: "dsh-tts-eq-bar" }),
          react.createElement("span", { className: "dsh-tts-eq-bar" }),
          react.createElement("span", { className: "dsh-tts-eq-bar" }),
        );
      }
      function PlayIcon() {
        return react.createElement(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 15,
            height: 15,
            fill: "currentColor",
            "aria-hidden": true,
          },
          react.createElement("path", {
            d: "M5 3.4v9.2c0 .7.8 1.1 1.4.7l6.6-4.6c.5-.4.5-1.1 0-1.5L6.4 2.7c-.6-.4-1.4 0-1.4.7z",
          }),
        );
      }
      function SpinnerIcon() {
        return react.createElement("span", {
          className: "dsh-tts-spinner",
          "aria-hidden": true,
        });
      }

      // ---------- styles ----------
      const CSS =
        ".dsh-tts-toggle{width:28px;height:28px;flex:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:999px;place-items:center;display:grid}" +
        ".dsh-tts-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}" +
        ".dsh-tts-toggle[data-active]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
        'div[class*="_tools"]>div[class*="_modes"]{order:2}' +
        'div[class*="_tools"]>.dsh-tts-toggle{order:1}' +
        ".dsh-tts-action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}" +
        ".dsh-tts-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}" +
        ".dsh-tts-action:disabled{cursor:default;opacity:.4}" +
        ".dsh-tts-action[data-active]{color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-eq{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;gap:2px}" +
        ".dsh-tts-eq-bar{width:2.5px;border-radius:1px;background:currentColor;height:6px;animation:dsh-tts-eq-bounce .9s ease-in-out infinite}" +
        ".dsh-tts-eq-bar:nth-child(1){animation-delay:0s}" +
        ".dsh-tts-eq-bar:nth-child(2){animation-delay:.15s}" +
        ".dsh-tts-eq-bar:nth-child(3){animation-delay:.3s}" +
        "@keyframes dsh-tts-eq-bounce{0%,100%{height:5px}50%{height:13px}}" +
        ".dsh-tts-settings{display:flex;flex-direction:column}" +
        ".dsh-tts-module{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 4px;border-bottom:1px solid var(--dsw-alias-border-secondary)}" +
        ".dsh-tts-module:last-child{border-bottom:none}" +
        ".dsh-tts-module-stack{flex-direction:column;align-items:stretch;gap:10px}" +
        ".dsh-tts-module-info{min-width:0}" +
        ".dsh-tts-module-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-module-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-top:2px}" +
        ".dsh-tts-select{max-width:300px;height:34px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit;color-scheme:light dark}" +
        ".dsh-tts-select option{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-select:hover{border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
        ".dsh-tts-preview-row{display:flex;align-items:center;gap:8px;width:100%}" +
        ".dsh-tts-preview-input{flex:1;min-width:0;height:34px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit}" +
        ".dsh-tts-preview-input:hover{border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-preview-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
        ".dsh-tts-preview-btn{width:38px;height:34px;flex:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border:none;border-radius:9px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);transition:background-color .15s ease,transform .1s ease,opacity .15s ease}" +
        ".dsh-tts-preview-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-primary);opacity:.88;transform:scale(1.05)}" +
        ".dsh-tts-preview-btn:active:not(:disabled){transform:scale(.95)}" +
        ".dsh-tts-preview-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}" +
        ".dsh-tts-preview-btn:disabled{cursor:default;opacity:.55}" +
        ".dsh-tts-spinner{width:15px;height:15px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:dsh-tts-spin .8s linear infinite}" +
        "@keyframes dsh-tts-spin{to{transform:rotate(360deg)}}" +
        ".dsh-tts-error{font-size:12px;line-height:18px;color:var(--dsw-alias-label-error);padding:2px 4px 0}" +
        ".dsh-tts-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:2px 4px 0}" +
        ".dsh-tts-rvc{background:var(--dsw-alias-bg-layer-2,transparent);border-radius:10px;padding:2px 10px 10px}" +
        ".dsh-tts-field{margin:8px 0}" +
        ".dsh-tts-rvc-row{display:flex;align-items:center;gap:10px;min-width:0}" +
        ".dsh-tts-rvc-label{flex:none;width:110px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:right}" +
        ".dsh-tts-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin:3px 0 0 120px;font-style:italic}" +
        ".dsh-tts-rvc-input{flex:1;min-width:0;height:30px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px;font-size:12px;font-family:inherit}" +
        ".dsh-tts-rvc-input:hover{border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-rvc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
        ".dsh-tts-rvc-input-num{flex:none;max-width:96px}" +
        ".dsh-tts-path{flex:1;min-width:0;display:flex;align-items:center;gap:6px}" +
        ".dsh-tts-path .dsh-tts-rvc-input{flex:0 0 80%;max-width:none}" +
        ".dsh-tts-browse{flex:none;height:30px;padding:0 12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit}" +
        ".dsh-tts-browse:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-upload{flex:1;min-width:0;display:flex;align-items:center;gap:8px}" +
        ".dsh-tts-file-btn{flex:none;height:30px;padding:0 12px;cursor:pointer;display:inline-flex;align-items:center;border:none;border-radius:8px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);font-size:12px;font-family:inherit}" +
        ".dsh-tts-file-btn:hover{opacity:.9}" +
        ".dsh-tts-upload-name{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".dsh-tts-picker{font-style:normal;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;max-height:180px;overflow:auto}" +
        ".dsh-tts-compact{margin-top:6px;padding:8px;background:var(--dsw-alias-bg-layer-2,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}" +
        ".dsh-tts-compact-row{display:flex;align-items:center;gap:8px;margin-top:6px}" +
        ".dsh-tts-compact-src{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".dsh-tts-compact-btn{flex:none;height:26px;padding:0 10px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit}" +
        ".dsh-tts-compact-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-compact-btn:disabled{cursor:default;opacity:.55}" +
        ".dsh-tts-compact-info{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:6px}" +
        ".dsh-tts-compact-ok{color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-compact-select{flex:none;height:26px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 8px;font-size:12px;font-family:inherit}" +
        ".dsh-tts-pack-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;margin-top:6px;background:var(--dsw-alias-bg-layer-2,transparent)}" +
        ".dsh-tts-pack-head{display:flex;align-items:center;gap:8px;justify-content:space-between}" +
        ".dsh-tts-pack-name{font-size:13px;color:var(--dsw-alias-label-primary);font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".dsh-tts-pack-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;line-height:16px}" +
        ".dsh-tts-pack-btn{flex:none;height:26px;padding:0 10px;cursor:pointer;border:none;border-radius:7px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);font-size:12px;font-family:inherit}" +
        ".dsh-tts-pack-btn:hover:not(:disabled){opacity:.88}" +
        ".dsh-tts-pack-btn:disabled{cursor:default;opacity:.55}" +
        ".dsh-tts-pack-btn[data-done]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-pack-head-actions{flex:none;display:flex;align-items:center;gap:6px}" +
        ".dsh-tts-pack-uninstall{background:transparent;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2)}" +
        ".dsh-tts-pack-uninstall:hover{color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-label-error)}" +
        ".dsh-tts-overlay{position:fixed;inset:0;z-index:40}" +
        ".dsh-tts-picker{position:relative;z-index:41}" +
        ".dsh-tts-diag{display:flex;flex-direction:column;gap:6px;margin-top:8px}" +
        ".dsh-tts-diag-row{display:flex;align-items:baseline;gap:8px;font-size:12px;line-height:18px}" +
        ".dsh-tts-diag-mark{flex:none;width:16px;text-align:center}" +
        ".dsh-tts-diag-name{flex:none;width:110px;color:var(--dsw-alias-label-secondary);text-align:right}" +
        ".dsh-tts-diag-detail{min-width:0;color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-diag-ok{color:var(--dsw-alias-label-success,var(--dsw-alias-label-primary))}" +
        ".dsh-tts-diag-fail{color:var(--dsw-alias-label-error)}" +
        ".dsh-tts-diag-warn{color:var(--dsw-alias-label-warning,var(--dsw-alias-label-secondary))}" +
        ".dsh-tts-pack-progress{flex:none;width:130px;display:flex;flex-direction:column;gap:3px}" +
        ".dsh-tts-pack-progress-bar{height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover,transparent);overflow:hidden}" +
        ".dsh-tts-pack-progress-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}" +
        ".dsh-tts-pack-progress-text{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}" +
        ".dsh-tts-picker-title{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}" +
        ".dsh-tts-picker-item{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;cursor:pointer;background:transparent;border:none;border-radius:6px;padding:4px 6px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:left;font-family:inherit}" +
        ".dsh-tts-picker-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-picker-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".dsh-tts-picker-size{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
        ".dsh-tts-slider{flex:1;min-width:0}" +
        ".dsh-tts-slider input[type=range]{width:100%;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}" +
        ".dsh-tts-slider-scale{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}" +
        ".dsh-tts-slider-value{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}" +
        ".dsh-tts-slider-end{white-space:nowrap}" +
        ".dsh-tts-advanced{margin-top:2px}" +
        ".dsh-tts-advanced summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);padding:4px 0;user-select:none}" +
        ".dsh-tts-advanced summary:hover{color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-advanced[open] summary{margin-bottom:6px}" +
        ".dsh-tts-footnote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:10px 4px 4px}";

      function insertCss(css) {
        const tag = document.createElement("style");
        tag.dataset.pluginCss = "dsh-plugin-tts";
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => {
          if (tag.parentNode) tag.parentNode.removeChild(tag);
        };
      }
      ctx.effect(() => insertCss(CSS), "dsh-plugin-tts: styles");

      // ---------- audio host (hidden <audio> in shell.overlay) ----------
      function TtsAudioHost() {
        react.useEffect(
          () => () => {
            shared.audioEl = null;
          },
          [],
        );
        return react.createElement("audio", {
          ref: el => {
            shared.audioEl = el;
          },
          style: { display: "none" },
          preload: "auto",
        });
      }
      slots.inject("shell.overlay", () =>
        slots.register(
          { name: "shell.overlay", id: "tts-audio-host", order: 1000 },
          TtsAudioHost,
        ),
      );

      // ---------- 1) input.left: auto-read toggle + watcher ----------
      function AutoReadToggle(props) {
        const [on, setOn] = react.useState(shared.autoRead);
        react.useEffect(
          () => () => {
            stopIfSource("auto");
          },
          [],
        );
        react.useEffect(() => {
          const session = props.session;
          if (!session) return;
          let maxSeq = -1;
          let newest = null;
          const nodes = session.nodes;
          if (nodes) {
            for (const n of nodes) {
              if (
                n &&
                n.kind === "assistant" &&
                typeof n.messageId === "string" &&
                n.seq > maxSeq
              ) {
                maxSeq = n.seq;
                newest = n;
              }
            }
          }
          if (!newest) return;
          const key = props.sessionId;
          const prev = shared.lastSeqBySession.get(key);
          if (prev === undefined) {
            shared.lastSeqBySession.set(key, maxSeq);
            return;
          }
          if (maxSeq > prev) {
            shared.lastSeqBySession.set(key, maxSeq);
            if (shared.autoRead) {
              const text = extractText(newest.blocks);
              if (text.trim()) speakText(text, "auto");
            }
          }
        }, [props.session]);
        const onClick = () => {
          const next = !shared.autoRead;
          shared.autoRead = next;
          setOn(next);
          if (!next) stopIfSource("auto");
        };
        return react.createElement(
          "button",
          {
            type: "button",
            className: "dsh-tts-toggle",
            "data-active": on || undefined,
            "aria-label": on ? "自动朗读已开启" : "自动朗读已关闭",
            "aria-pressed": on || undefined,
            title: on
              ? "自动朗读：开启（点击关闭）"
              : "自动朗读：关闭（点击开启）",
            onClick: onClick,
          },
          SpeakerIcon(),
        );
      }
      slots.inject("conversation.input.left", () =>
        slots.register(
          { name: "conversation.input.left", id: "tts-autoread", order: 20 },
          AutoReadToggle,
        ),
      );

      // ---------- 2) assistant-actions: per-message read-aloud button ----------
      function ReadAloudButton(props) {
        useSharedForce();
        const useSession = props.useSession;
        let nodes = null;
        if (useSession) nodes = useSession(s => s.nodes);
        let node = null;
        if (nodes) {
          for (const n of nodes) {
            if (
              n &&
              n.kind === "assistant" &&
              n.messageId === props.messageId
            ) {
              node = n;
              break;
            }
          }
        }
        const raw = node ? extractText(node.blocks) : "";
        const plain = plainText(raw);
        const isPlaying =
          shared.speaking && !!plain && shared.currentText === plain;
        const cp = shared.chunkProgress;
        const playingLabel = isPlaying
          ? cp && cp.total > 1
            ? "停止朗读（第 " + cp.index + "/" + cp.total + " 段播放中）"
            : "停止朗读"
          : "朗读本条消息";
        const onClick = () => {
          if (plain) speakText(plain, "manual");
        };
        return react.createElement(
          "button",
          {
            type: "button",
            className: "dsh-tts-action",
            "data-active": isPlaying || undefined,
            "aria-label": playingLabel,
            title: playingLabel,
            disabled: !plain || undefined,
            onClick: onClick,
          },
          isPlaying ? EqualizerIcon() : SpeakerIcon(),
        );
      }
      slots.inject("conversation.chat.assistant-actions", () =>
        slots.register(
          {
            name: "conversation.chat.assistant-actions",
            id: "tts-read",
            order: 20,
          },
          ReadAloudButton,
        ),
      );

      // ---------- 3) settings.plugins.tab: voice settings panel ----------
      const VOICES = [
        ["zh-CN-XiaoxuanNeural", "晓萱（zh-CN-XiaoxuanNeural）"],
        ["zh-CN-XiaoyiNeural", "晓伊（zh-CN-XiaoyiNeural）"],
        ["zh-CN-YunxiNeural", "云希（zh-CN-YunxiNeural）"],
        ["zh-CN-YunyangNeural", "云扬（zh-CN-YunyangNeural）"],
        ["zh-CN-XiaoxiaoNeural", "晓晓（zh-CN-XiaoxiaoNeural）"],
        ["zh-CN-YunjianNeural", "云健（zh-CN-YunjianNeural）"],
        ["zh-CN-YunxiaNeural", "云夏（zh-CN-YunxiaNeural）"],
        [
          "zh-CN-liaoning-XiaobeiNeural",
          "晓北·辽宁（zh-CN-liaoning-XiaobeiNeural）",
        ],
        [
          "zh-CN-shaanxi-XiaoniNeural",
          "晓妮·陕西（zh-CN-shaanxi-XiaoniNeural）",
        ],
        ["zh-TW-HsiaoChenNeural", "曉臻（zh-TW-HsiaoChenNeural）"],
        ["zh-TW-HsiaoYuNeural", "曉雨（zh-TW-HsiaoYuNeural）"],
        ["zh-TW-YunJheNeural", "雲哲（zh-TW-YunJheNeural）"],
        ["zh-HK-HiuGaaiNeural", "曉佳（zh-HK-HiuGaaiNeural）"],
        ["zh-HK-HiuMaanNeural", "曉曼（zh-HK-HiuMaanNeural）"],
        ["zh-HK-WanLungNeural", "雲龍（zh-HK-WanLungNeural）"],
        ["en-US-AriaNeural", "Aria（en-US-AriaNeural）"],
        ["en-US-JennyNeural", "Jenny（en-US-JennyNeural）"],
        ["en-US-GuyNeural", "Guy（en-US-GuyNeural）"],
        ["en-GB-SoniaNeural", "Sonia（en-GB-SoniaNeural）"],
        ["ja-JP-NanamiNeural", "七海（ja-JP-NanamiNeural）"],
        ["ko-KR-SunHiNeural", "SunHi（ko-KR-SunHiNeural）"],
        ["fr-FR-DeniseNeural", "Denise（fr-FR-DeniseNeural）"],
      ];

      function VoiceSettingsPanel() {
        useSharedForce();
        const [voice, setVoice] = react.useState(shared.voice);
        const [preview, setPreview] =
          react.useState("你好，这是一个语音测试。");
        const [playingText, setPlayingText] = react.useState(null);
        const [error, setError] = react.useState(null);
        const errorTimer = react.useRef(null);
        const isPreviewPlaying =
          shared.speaking &&
          !!playingText &&
          shared.currentText === playingText;
        react.useEffect(() => {
          if (!shared.speaking) setPlayingText(null);
        }, [shared.speaking]);
        const changeVoice = e => {
          const v = e.target.value;
          shared.voice = v;
          setVoice(v);
        };
        const showError = msg => {
          if (errorTimer.current) {
            clearTimeout(errorTimer.current);
            errorTimer.current = null;
          }
          setError(msg);
          if (msg) {
            errorTimer.current = setTimeout(() => {
              setError(null);
              errorTimer.current = null;
            }, 5000);
          }
        };
        const onPreview = () => {
          const target = plainText(preview);
          if (!target) {
            showError("请输入要试听的内容");
            return;
          }
          if (isPreviewPlaying) {
            stopSpeaking();
            setPlayingText(null);
            return;
          }
          showError(null);
          setPlayingText(target);
          speakText(target, "manual", msg =>
            showError("语音合成失败：" + msg),
          ).then(r => {
            if (r && !r.ok && r.error !== "interrupted") {
              showError("语音合成失败：" + r.error);
            }
            if (r && !r.ok) setPlayingText(null);
          });
        };
        const voiceOptions = VOICES.map(v =>
          react.createElement("option", { key: v[0], value: v[0] }, v[1]),
        );
        const [provider, setProvider] = react.useState(shared.provider);
        const [, setRvcTick] = react.useState(0);
        const changeProvider = e => {
          shared.provider = e.target.value;
          setProvider(e.target.value);
        };
        const setRvc = (key, value) => {
          shared.rvc[key] = value;
          setRvcTick(n => n + 1);
        };
        // ---- 文件选择器（RVC 服务文件发现）----
        const [picker, setPicker] = react.useState(null);
        // Esc closes the file picker; click on the transparent overlay also closes it
        react.useEffect(() => {
          const onKey = e => {
            if (e.key === "Escape") setPicker(null);
          };
          window.addEventListener("keydown", onKey);
          return () => window.removeEventListener("keydown", onKey);
        }, []);
        const openPicker = async kind => {
          setPicker({ kind, files: [], loading: true, error: null });
          try {
            const r = await fetch(
              "/dsh-tts-api/rvc-files?baseUrl=" +
                encodeURIComponent(shared.rvc.baseUrl) +
                "&kind=" +
                kind,
            );
            const data = await r.json().catch(() => null);
            if (!r.ok || !data || data.error) {
              throw new Error((data && data.error) || "HTTP " + r.status);
            }
            setPicker({ kind, files: data.files || [], loading: false, error: null });
          } catch (e) {
            setPicker({
              kind,
              files: [],
              loading: false,
              error: "读取文件列表失败：" + String((e && e.message) || e),
            });
          }
        };
        const pickFile = (kind, f) => {
          setRvc(kind === "pth" ? "model" : "index", f.path);
          setPicker(null);
        };
        // ---- 音色包（注册表 + 下载安装）----
        const PKG_SETTINGS_KEY = "dsh-tts-pack-settings"; // { registry, proxy }
        const PKG_ACTIVE_KEY = "dsh-tts-pack-active";      // { key, packId }
        const [registryUrl, setRegistryUrl] = react.useState("");
        const [packProxy, setPackProxy] = react.useState("");
        const [packs, setPacks] = react.useState(null); // { loading, error, list }
        const [installed, setInstalled] = react.useState({});
        const [installing, setInstalling] = react.useState(null);
        const [packNote, setPackNote] = react.useState(null);
        const [packIdx, setPackIdx] = react.useState({}); // packId -> selected index variant id
        const [installProg, setInstallProg] = react.useState(null); // { packId, pct, phase, speed }
        const [packsDir, setPacksDir] = react.useState(null);
        const savePackSettings = () => {
          try {
            localStorage.setItem(
              PKG_SETTINGS_KEY,
              JSON.stringify({ registry: registryUrl.trim(), proxy: packProxy.trim() }),
            );
          } catch (e) { /* non-fatal */ }
        };
        const refreshInstalled = async () => {
          try {
            const r = await fetch("/dsh-tts-api/rvc-packs-installed");
            const d = await r.json().catch(() => null);
            if (d && d.installed) setInstalled(d.installed);
            if (d && d.packsDir) setPacksDir(d.packsDir);
          } catch (e) { /* non-fatal */ }
        };
        // restore persisted settings + re-attach to an in-flight download
        react.useEffect(() => {
          refreshInstalled();
          try {
            const s = JSON.parse(localStorage.getItem(PKG_SETTINGS_KEY) || "null");
            if (s) {
              if (s.registry) setRegistryUrl(s.registry);
              if (s.proxy) setPackProxy(s.proxy);
            }
          } catch (e) { /* non-fatal */ }
          try {
            const a = JSON.parse(localStorage.getItem(PKG_ACTIVE_KEY) || "null");
            if (a && a.key && a.packId) restoreActiveInstall(a.key, a.packId);
            else localStorage.removeItem(PKG_ACTIVE_KEY);
          } catch (e) { /* non-fatal */ }
        }, []);
        // re-attach to a download started before the panel was closed
        const restoreActiveInstall = (key, packId) => {
          let waitingCount = 0;
          const poll = async () => {
            for (let i = 0; i < 120; i++) {
              await new Promise(res => setTimeout(res, 500));
              try {
                const pr = await fetch("/dsh-tts-api/rvc-pack-progress?key=" + encodeURIComponent(key));
                const d = await pr.json().catch(() => null);
                if (d && d.finished) {
                  setInstalling(null);
                  setInstallProg(null);
                  localStorage.removeItem(PKG_ACTIVE_KEY);
                  refreshInstalled();
                  return;
                }
                if (d && d.waiting !== true && d.total) {
                  waitingCount = 0;
                  setInstalling(packId);
                  setInstallProg({
                    packId,
                    pct: Math.min(100, Math.round((d.done / d.total) * 100)),
                    phase: d.phase === "索引" ? "索引" : "模型",
                    speed: d.speed || 0,
                  });
                  continue;
                }
                // no entry yet — either still preparing or already gone
                waitingCount++;
                if (waitingCount > 4) {
                  // give up: entry expired without a finish flag
                  localStorage.removeItem(PKG_ACTIVE_KEY);
                  setInstalling(null);
                  setInstallProg(null);
                  refreshInstalled();
                  return;
                }
                setInstalling(packId);
                setInstallProg({ packId, pct: 0, phase: "准备中…", speed: 0 });
              } catch (e) { /* transient */ }
            }
          };
          poll();
        };
        const fetchPacks = async () => {
          const reg = registryUrl.trim();
          if (!reg) {
            setPacks({ loading: false, error: "请先填写音色包仓库地址", list: [] });
            return;
          }
          savePackSettings();
          setPacks({ loading: true, error: null, list: [] });
          try {
            const r = await fetch(
              "/dsh-tts-api/rvc-packs?registry=" +
                encodeURIComponent(reg) +
                (packProxy.trim() ? "&proxy=" + encodeURIComponent(packProxy.trim()) : ""),
            );
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || d.error) {
              throw new Error((d && d.error) || "HTTP " + r.status);
            }
            setPacks({ loading: false, error: null, list: d.packs || [] });
            refreshInstalled(); // reconcile installed state (files may have been removed)
          } catch (e) {
            setPacks({
              loading: false,
              error: "获取列表失败：" + String((e && e.message) || e),
              list: [],
            });
          }
        };
        const installPack = async (pack, indexId) => {
          const progressKey = pack.id + "-" + Date.now();
          try {
            localStorage.setItem(PKG_ACTIVE_KEY, JSON.stringify({ key: progressKey, packId: pack.id }));
          } catch (e) { /* non-fatal */ }
          setInstalling(pack.id);
          setPackNote(null);
          setInstallProg({ packId: pack.id, pct: 0, phase: "等待开始", speed: 0 });
          const fmtSpeed = bps =>
            bps >= 1048576
              ? (bps / 1048576).toFixed(1) + " MB/s"
              : Math.round(bps / 1024) + " KB/s";
          let settled = false;
          const req = fetch("/dsh-tts-api/rvc-pack-install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registry: registryUrl.trim(),
              packId: pack.id,
              indexId: indexId || "",
              progressKey: progressKey,
              proxy: packProxy.trim(),
            }),
          })
            .then(r => r.json().catch(() => null))
            .catch(e => ({ error: String((e && e.message) || e) }));
          const poll = (async () => {
            const pollStart = Date.now();
            while (!settled) {
              await new Promise(res => setTimeout(res, 250));
              if (settled) break;
              if (Date.now() - pollStart > 720000) break; // safety cap (12 min)
              try {
                const pr = await fetch(
                  "/dsh-tts-api/rvc-pack-progress?key=" + encodeURIComponent(progressKey),
                );
                const d = await pr.json().catch(() => null);
                if (!d || d.waiting) {
                  // install not reporting yet (manifest fetch etc.) — keep polling
                  setInstallProg(p =>
                    p && p.packId === pack.id ? { ...p, pct: 0, phase: "准备中…", speed: 0 } : p,
                  );
                  continue;
                }
                const finished = !!d.finished;
                const pct = d.total
                  ? Math.min(100, Math.round((d.done / d.total) * 100))
                  : 0;
                setInstallProg({
                  packId: pack.id,
                  pct: finished ? 100 : pct,
                  phase: finished ? "完成" : d.phase === "索引" ? "索引" : "模型",
                  speed: d.speed || 0,
                });
              } catch (e) { /* transient poll error — keep trying */ }
            }
          })();
          const d = await req;
          settled = true;
          if (d && !d.error && d.ok !== false) {
            setRvc("model", d.modelPath);
            if (d.indexPath) setRvc("index", d.indexPath);
            if (pack.baseVoice) setRvc("baseVoice", pack.baseVoice);
            if (typeof pack.indexRate === "number") setRvc("indexRate", pack.indexRate);
            if (pack.f0Method) setRvc("f0Method", pack.f0Method);
            setPackNote({
              ok: true,
              text: "已安装并启用「" + (d.name || pack.id) + "」" + (d.skipped ? "（已是最新版本）" : ""),
            });
            refreshInstalled();
          } else {
            setPackNote({
              ok: false,
              text: "安装失败：" + String((d && d.error) || "未知错误"),
            });
          }
          setInstallProg(null);
          setInstalling(null);
          try {
            localStorage.removeItem(PKG_ACTIVE_KEY);
          } catch (e) { /* non-fatal */ }
        };
        const uninstallPack = async pack => {
          if (!window.confirm("确定卸载音色包「" + (pack.name || pack.id) + "」？将删除已下载的模型与索引文件。")) return;
          setPackNote(null);
          try {
            const r = await fetch("/dsh-tts-api/rvc-pack-uninstall", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ packId: pack.id }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || d.error) throw new Error((d && d.error) || "HTTP " + r.status);
            // clear the rvc paths if they pointed into the removed pack dir
            const inst = installed[pack.id];
            if (inst) {
              if (shared.rvc.model && inst.modelPath && shared.rvc.model === inst.modelPath) setRvc("model", "");
              if (shared.rvc.index && inst.indexPath && shared.rvc.index === inst.indexPath) setRvc("index", "");
            }
            setPackNote({ ok: true, text: "已卸载「" + (pack.name || pack.id) + "」" });
            refreshInstalled();
          } catch (e) {
            setPackNote({ ok: false, text: "卸载失败：" + String((e && e.message) || e) });
          }
        };
        // ---- 一键诊断（Edge 合成 / RVC 服务）----
        const [diag, setDiag] = react.useState(null); // { running, checks, error }
        const runDiagnose = async () => {
          setDiag({ running: true, checks: null, error: null });
          try {
            const r = await fetch("/dsh-tts-api/diagnose", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rvcBaseUrl: shared.rvc.baseUrl }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || d.error) throw new Error((d && d.error) || "HTTP " + r.status);
            setDiag({ running: false, checks: d.checks || [], error: null });
          } catch (e) {
            setDiag({ running: false, checks: null, error: String((e && e.message) || e) });
          }
        };
        const diagMark = c =>
          c.ok ? react.createElement("span", { className: "dsh-tts-diag-ok" }, "✓")
            : c.cls === "warn"
              ? react.createElement("span", { className: "dsh-tts-diag-warn" }, "!")
              : react.createElement("span", { className: "dsh-tts-diag-fail" }, "✗");
        const diagRow = c =>
          react.createElement(
            "div",
            { className: "dsh-tts-diag-row" },
            react.createElement("span", { className: "dsh-tts-diag-mark" }, diagMark(c)),
            react.createElement("span", { className: "dsh-tts-diag-name" }, c.name),
            react.createElement(
              "span",
              {
                className:
                  "dsh-tts-diag-detail " +
                  (c.ok ? "dsh-tts-diag-ok" : c.cls === "warn" ? "dsh-tts-diag-warn" : "dsh-tts-diag-fail"),
              },
              c.detail || "",
            ),
          );
        const diagModule = () =>
          react.createElement(
            "div",
            { className: "dsh-tts-module dsh-tts-module-stack" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                "诊断",
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                "一键检查：Edge TTS 在线合成是否正常、本地 RVC 服务是否已启动、模型是否已加载",
              ),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-preview-row" },
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  onClick: runDiagnose,
                  disabled: !!diag && diag.running,
                },
                diag && diag.running ? "检查中…（约 1-2 秒）" : "运行诊断",
              ),
            ),
            diag && diag.checks
              ? react.createElement("div", { className: "dsh-tts-diag" }, diag.checks.map(diagRow))
              : null,
            diag && diag.error
              ? react.createElement("div", { className: "dsh-tts-error" }, "诊断失败：" + diag.error)
              : null,
          );
        const packSection = () =>
          react.createElement(
            "div",
            { className: "dsh-tts-module dsh-tts-module-stack dsh-tts-rvc" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                "音色包",
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                "从网上（或朋友的分享）一键下载现成音色，下载好自动启用，不用自己找文件",
              ),
              packsDir
                ? react.createElement(
                    "div",
                    { className: "dsh-tts-compact-info" },
                    "下载后安装到：" + packsDir + "（模型与索引会自动填入上方 RVC 配置）",
                  )
                : null,
            ),
            field(
              "仓库地址",
              react.createElement(
                "div",
                { className: "dsh-tts-path" },
                react.createElement("input", {
                  className: "dsh-tts-rvc-input",
                  value: registryUrl,
                  placeholder: "https://example.com/tts-packs",
                  onChange: e => {
                    setRegistryUrl(e.target.value);
                    savePackSettings();
                  },
                }),
                react.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-tts-browse",
                    onClick: fetchPacks,
                    disabled: !!packs && packs.loading,
                  },
                  packs && packs.loading ? "加载中…" : "获取列表",
                ),
              ),
              "音色作者会给你一个网址（仓库地址），填进去点「获取列表」就能看到有哪些音色。下载和文件校验由插件自动完成",
            ),
            field(
              "代理地址（可选）",
              react.createElement("input", {
                className: "dsh-tts-rvc-input",
                value: packProxy,
                placeholder: "http://127.0.0.1:7897（Clash 等本地代理）",
                onChange: e => {
                  setPackProxy(e.target.value);
                  savePackSettings();
                },
              }),
              "直连 GitHub raw 很慢时（实测 ~100KB/s），填本地代理（如 Clash 的 http://127.0.0.1:7897）可提速到十几 MB/s；留空 = 直连",
            ),
            packs && packs.loading
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-compact-info" },
                  "正在获取清单…",
                )
              : null,
            packs && packs.error
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-error" },
                  packs.error,
                )
              : null,
            packs && packs.list.length
              ? packs.list.map(p =>
                  react.createElement(
                    "div",
                    { key: p.id, className: "dsh-tts-pack-card" },
                    react.createElement(
                      "div",
                      { className: "dsh-tts-pack-head" },
                      react.createElement(
                        "span",
                        { className: "dsh-tts-pack-name" },
                        p.name || p.id,
                      ),
                      installed[p.id]
                        ? react.createElement(
                            "div",
                            { className: "dsh-tts-pack-head-actions" },
                            react.createElement(
                              "button",
                              {
                                type: "button",
                                className: "dsh-tts-pack-btn",
                                "data-done": true,
                                disabled: true,
                              },
                              "已安装 v" + (installed[p.id].version || ""),
                            ),
                            react.createElement(
                              "button",
                              {
                                type: "button",
                                className: "dsh-tts-pack-btn dsh-tts-pack-uninstall",
                                onClick: () => uninstallPack(p),
                              },
                              "卸载",
                            ),
                          )
                        : installing === p.id && installProg && installProg.packId === p.id
                          ? react.createElement(
                              "div",
                              { className: "dsh-tts-pack-progress" },
                              react.createElement(
                                "div",
                                { className: "dsh-tts-pack-progress-bar" },
                                react.createElement("div", {
                                  className: "dsh-tts-pack-progress-fill",
                                  style: { width: (installProg.pct || 0) + "%" },
                                }),
                              ),
                              react.createElement(
                                "span",
                                { className: "dsh-tts-pack-progress-text" },
                                installProg.phase +
                                  " " +
                                  (installProg.pct || 0) +
                                  "%" +
                                  (installProg.speed
                                    ? " · " +
                                      (installProg.speed >= 1048576
                                        ? (installProg.speed / 1048576).toFixed(1) + " MB/s"
                                        : Math.round(installProg.speed / 1024) + " KB/s")
                                    : ""),
                              ),
                            )
                          : react.createElement(
                              "button",
                              {
                                type: "button",
                                className: "dsh-tts-pack-btn",
                                disabled: installing === p.id,
                                onClick: () =>
                                  installPack(
                                    p,
                                    (Array.isArray(p.indexes) && p.indexes.length && packIdx[p.id]) ||
                                      (Array.isArray(p.indexes) && p.indexes.length ? p.indexes[0].id : ""),
                                  ),
                              },
                              installing === p.id ? "下载中…" : "下载并启用",
                            ),
                    ),
                    Array.isArray(p.indexes) && p.indexes.length > 1
                      ? react.createElement(
                          "div",
                          { className: "dsh-tts-compact-row", style: { marginTop: 6 } },
                          react.createElement(
                            "span",
                            { className: "dsh-tts-compact-src" },
                            "索引版本：",
                          ),
                          react.createElement(
                            "select",
                            {
                              className: "dsh-tts-compact-select",
                              value: packIdx[p.id] || p.indexes[0].id,
                              disabled: installing === p.id,
                              onChange: e => setPackIdx(s => ({ ...s, [p.id]: e.target.value })),
                            },
                            p.indexes.map(i =>
                              react.createElement("option", { key: i.id, value: i.id }, i.name || i.id),
                            ),
                          ),
                        )
                      : null,
                    react.createElement(
                      "div",
                      { className: "dsh-tts-pack-meta" },
                      (p.description || "") +
                        " ｜ 模型 " +
                        fmtMb(p.model && p.model.size) +
                        (Array.isArray(p.indexes) && p.indexes.length
                          ? " + 可选索引 " +
                            p.indexes.length +
                            " 个（" +
                            p.indexes.map(i => fmtMb(i.size)).join("/") +
                            "）"
                          : p.index && p.index.size
                            ? " + 索引 " + fmtMb(p.index.size)
                            : "（免索引）") +
                        " ｜ 许可 " +
                        (p.license || "未知") +
                        (p.author ? " ｜ 作者 " + p.author : ""),
                    ),
                  ),
                )
              : null,
            packNote
              ? react.createElement(
                  "div",
                  {
                    className: packNote.ok ? "dsh-tts-compact-info dsh-tts-compact-ok" : "dsh-tts-error",
                  },
                  packNote.text,
                )
              : null,
            react.createElement(
              "div",
              { className: "dsh-tts-footnote" },
              "只能安装版权允许分发的音色（注意看每个包的「许可」）。演示音色 azusa-test 受版权限制，不会出现在公开仓库里。",
            ),
          );
        // ---- 紧凑索引生成器 ----
        const [compact, setCompact] = react.useState(null);
        const COMPACT_TARGETS = [
          [2000, "2k（约 6 MB）"],
          [5000, "5k（约 15 MB）"],
          [10000, "10k（约 30 MB）"],
          [20000, "20k（约 60 MB）"],
        ];
        const runCompact = async () => {
          if (!shared.rvc.index) {
            setCompact(c => ({ ...c, error: "请先填写或选择要压缩的索引路径" }));
            return;
          }
          setCompact(c => ({ ...c, busy: true, error: null, result: null }));
          try {
            const r = await fetch("/dsh-tts-api/rvc-compact-index", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baseUrl: shared.rvc.baseUrl,
                index: shared.rvc.index,
                target_vectors: compact.target,
              }),
            });
            const data = await r.json().catch(() => null);
            if (!r.ok || !data || data.error) {
              throw new Error((data && data.error) || "HTTP " + r.status);
            }
            if (data.already_small) {
              setCompact(c => ({
                ...c,
                busy: false,
                error: null,
                result: { alreadySmall: true, size: data.size, vectors: data.vectors },
              }));
              return;
            }
            setRvc("index", data.path); // 生成成功自动填入索引路径
            setCompact(c => ({
              ...c,
              busy: false,
              error: null,
              result: data,
            }));
          } catch (e) {
            setCompact(c => ({
              ...c,
              busy: false,
              error: "生成失败：" + String((e && e.message) || e),
            }));
          }
        };
        const compactPanel = () => {
          if (!compact || !compact.open) return null;
          const fmtMb = n => ((n || 0) / 1048576).toFixed(1) + " MB";
          const srcName = shared.rvc.index
            ? shared.rvc.index.split(/[\\/]/).pop()
            : "（未填写索引路径）";
          return react.createElement(
            "div",
            { className: "dsh-tts-compact" },
            react.createElement(
              "div",
              { className: "dsh-tts-picker-title" },
              "生成紧凑索引 —— 把大索引变小：从原索引中抽样重建，音色还原度基本不变。索引越小，加载越快、越容易分享",
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-compact-src" },
              "来源：" + srcName,
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-compact-row" },
              react.createElement(
                "select",
                {
                  className: "dsh-tts-compact-select",
                  value: compact.target,
                  disabled: !!compact.busy,
                  onChange: e => setCompact(c => ({ ...c, target: Number(e.target.value) })),
                },
                COMPACT_TARGETS.map(t =>
                  react.createElement("option", { key: t[0], value: t[0] }, t[1]),
                ),
              ),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-compact-btn",
                  disabled: !!compact.busy,
                  onClick: runCompact,
                },
                compact.busy ? "构建中…" : "生成",
              ),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-compact-btn",
                  disabled: !!compact.busy,
                  onClick: () => setCompact(null),
                },
                "关闭",
              ),
            ),
            compact.busy
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-compact-info" },
                  "正在读取大索引并抽样重建…（约几秒到几十秒，内存峰值 ~1GB）",
                )
              : null,
            compact.error
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-error" },
                  compact.error,
                )
              : null,
            compact.result
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-compact-info dsh-tts-compact-ok" },
                  compact.result.alreadySmall
                    ? "原索引已足够小（" + fmtMb(compact.result.size) + "），无需压缩。"
                    : "已生成：" +
                      compact.result.path.split(/[\\/]/).pop() +
                      "（" +
                      fmtMb(compact.result.size) +
                      "，原 " +
                      fmtMb(compact.result.source_size) +
                      "，-" +
                      compact.result.reduction_pct +
                      "%），已自动填入索引路径。",
                )
              : null,
          );
        };
        const pickerList = kind => {
          const p = picker;
          if (!p || p.kind !== kind) return null;
          if (p.loading)
            return react.createElement(
              "div",
              { className: "dsh-tts-picker" },
              "正在读取文件列表…",
            );
          if (p.error)
            return react.createElement(
              "div",
              { className: "dsh-tts-picker dsh-tts-error" },
              p.error,
            );
          return react.createElement(
            "div",
            { className: "dsh-tts-picker" },
            react.createElement(
              "div",
              { className: "dsh-tts-picker-title" },
              p.files.length
                ? "发现 " + p.files.length + " 个文件（点击选择）"
                : "未发现文件（可手动输入路径）",
            ),
            p.files.map(f =>
              react.createElement(
                "button",
                {
                  key: f.path,
                  type: "button",
                  className: "dsh-tts-picker-item",
                  onClick: () => pickFile(kind, f),
                },
                react.createElement(
                  "span",
                  { className: "dsh-tts-picker-name" },
                  f.name,
                ),
                react.createElement(
                  "span",
                  { className: "dsh-tts-picker-size" },
                  (f.size / 1048576).toFixed(1) + " MB",
                ),
              ),
            ),
          );
        };
        const onUploadAudio = e => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const b64 = String(reader.result || "").split(",")[1] || "";
            setRvc("baseAudioData", b64);
            setRvc("baseAudioName", file.name);
          };
          reader.readAsDataURL(file);
        };
        const field = (label, control, note) =>
          react.createElement(
            "div",
            { className: "dsh-tts-field" },
            react.createElement(
              "div",
              { className: "dsh-tts-rvc-row" },
              react.createElement(
                "span",
                { className: "dsh-tts-rvc-label" },
                label,
              ),
              control,
            ),
            note
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-note" },
                  note,
                )
              : null,
          );
        const textIn = (key, placeholder) =>
          react.createElement("input", {
            className: "dsh-tts-rvc-input",
            value: shared.rvc[key],
            placeholder: placeholder,
            onChange: e => setRvc(key, e.target.value),
          });
        const num = (key, step, min) =>
          react.createElement("input", {
            className: "dsh-tts-rvc-input dsh-tts-rvc-input-num",
            type: "number",
            step: step,
            min: min,
            value: shared.rvc[key],
            onChange: e => setRvc(key, Number(e.target.value)),
          });
        const sel = (key, options) =>
          react.createElement(
            "select",
            {
              className: "dsh-tts-rvc-input dsh-tts-select",
              value: shared.rvc[key],
              onChange: e => setRvc(key, e.target.value),
            },
            options.map(o =>
              react.createElement("option", { key: o[0], value: o[0] }, o[1]),
            ),
          );
        const selNum = (key, options) =>
          react.createElement(
            "select",
            {
              className: "dsh-tts-rvc-input dsh-tts-select",
              value: shared.rvc[key],
              onChange: e => setRvc(key, Number(e.target.value)),
            },
            options.map(o =>
              react.createElement("option", { key: o[0], value: o[0] }, o[1]),
            ),
          );
        const slider = (key, min, max, step, fmt) =>
          react.createElement(
            "div",
            { className: "dsh-tts-slider" },
            react.createElement("input", {
              type: "range",
              min: min,
              max: max,
              step: step,
              value: shared.rvc[key],
              onChange: e => setRvc(key, Number(e.target.value)),
            }),
            react.createElement(
              "div",
              { className: "dsh-tts-slider-scale" },
              react.createElement(
                "span",
                { className: "dsh-tts-slider-end" },
                fmt(min),
              ),
              react.createElement(
                "span",
                { className: "dsh-tts-slider-value" },
                fmt(shared.rvc[key]),
              ),
              react.createElement(
                "span",
                { className: "dsh-tts-slider-end" },
                fmt(max),
              ),
            ),
          );
        const pctFmt = v => Math.round(v * 100) + "%";
        const pct100Fmt = v =>
          v === 0 ? "默认" : (v > 0 ? "+" : "") + v + "%";
        const semiFmt = v => (v > 0 ? "+" : "") + v + " 半音";
        const fmtMb = n =>
          n ? (n / 1048576 >= 100 ? (n / 1048576 / 1024).toFixed(1) + " GB" : (n / 1048576).toFixed(1) + " MB") : "0 MB";
        const BASE_VOICES = [
          ["zh-CN-YunyangNeural", "云扬（男声）"],
          ["zh-CN-YunxiNeural", "云希（男声）"],
          ["zh-CN-YunxiaNeural", "云夏（男声）"],
          ["zh-CN-XiaoxiaoNeural", "晓晓（女声）"],
          ["zh-CN-XiaoyiNeural", "晓伊（女声）"],
          ["en-US-GuyNeural", "Guy（en 男声）"],
          ["en-US-JennyNeural", "Jenny（en 女声）"],
        ];
        const F0_OPTIONS = [
          ["rmvpe", "rmvpe（效果最好）"],
          ["pm", "pm（最快）"],
          ["harvest", "harvest（低音好但慢）"],
          ["crepe", "crepe（吃 GPU）"],
        ];
        const SR_OPTIONS = [
          [16000, "16 kHz"],
          [24000, "24 kHz"],
          [32000, "32 kHz"],
          [40000, "40 kHz"],
          [48000, "48 kHz"],
        ];

        // 声音调节 —— Edge TTS 属性，两种 provider 通用
        const soundSection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              "声音调节",
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              provider === "rvc"
                ? "调整朗读的语气和速度（转换前生效，最终音色会保留这些语调）"
                : "直接作用于 Edge TTS 朗读（0 = 默认）",
            ),
          ),
          field(
            "语速",
            slider("baseRate", -50, 50, 1, pct100Fmt),
            "朗读快慢：向左慢、向右快，0 为默认",
          ),
          field(
            "音调",
            slider("basePitch", -50, 50, 1, pct100Fmt),
            "声音高低：负值更低沉，正值更明亮",
          ),
          field(
            "音量",
            slider("baseVolume", -50, 50, 1, pct100Fmt),
            "朗读响度：负值更轻，正值更响",
          ),
        );

        const rvcSection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack dsh-tts-rvc" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              "RVC 配置",
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              "用你自己训练好的音色模型来朗读。需要先在电脑上启动一个转换服务（见 README 使用手册），再在这里填好模型路径",
            ),
          ),
          field(
            "服务地址",
            textIn("baseUrl", "http://127.0.0.1:4892"),
            "一般保持默认即可：这是你电脑上那个转换服务的地址（默认 4892 端口）",
          ),
          field(
            "原声来源",
            sel("baseSource", [
              ["edge", "让 Edge TTS 先读一遍"],
              ["upload", "上传自己的音频"],
            ]),
            "转换前的原声从哪里来：让 Edge TTS 自动读一遍（推荐，最方便），或上传你自己的一段录音/音频",
          ),
          shared.rvc.baseSource === "upload"
            ? field(
                "上传音频",
                react.createElement(
                  "div",
                  { className: "dsh-tts-upload" },
                  react.createElement(
                    "label",
                    { className: "dsh-tts-file-btn" },
                    "选择文件",
                    react.createElement("input", {
                      type: "file",
                      accept: ".wav,.mp3,.m4a,.ogg,.flac,audio/*",
                      style: { display: "none" },
                      onChange: onUploadAudio,
                    }),
                  ),
                  react.createElement(
                    "span",
                    { className: "dsh-tts-upload-name" },
                    shared.rvc.baseAudioName || "未选择文件",
                  ),
                ),
                "上传后直接用这段音频做转换，不再经过 Edge TTS；上面的语速/音调/音量设置不适用",
              )
            : null,
          shared.rvc.baseSource === "edge"
            ? field(
                "原声音色",
                sel("baseVoice", BASE_VOICES),
                "转换前由 Edge TTS 用哪个声音读（决定语气和停顿）；转换后说话人声音会变成你模型的音色",
              )
            : null,
          field(
            "模型路径 (.pth)",
            react.createElement(
              "div",
              { className: "dsh-tts-path" },
              textIn("model", "E:\\...\\assets\\weights\\xxx.pth"),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  onClick: () => openPicker("pth"),
                },
                "浏览",
              ),
            ),
            picker && picker.kind === "pth"
              ? pickerList("pth")
              : "你的音色模型文件（.pth），通常叫 xxx.pth。用「浏览」从电脑上选，或直接粘贴路径",
          ),
          field(
            "索引路径 (.index)",
            react.createElement(
              "div",
              { className: "dsh-tts-path" },
              textIn("index", "留空 = 免索引"),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  onClick: () => openPicker("index"),
                },
                "浏览",
              ),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  title: "生成紧凑索引：把几百 MB 的索引缩到几 MB（音色还原度基本不变）",
                  onClick: () =>
                    setCompact({ open: true, busy: false, error: null, result: null, target: 10000 }),
                },
                "压缩索引",
              ),
            ),
            react.createElement(
              react.Fragment,
              null,
              picker && picker.kind === "index"
                ? pickerList("index")
                : "可选。留空 = 免索引（效果略降但能用）；「浏览」选 .index 文件；「压缩索引」把大索引缩到几 MB",
              compactPanel(),
            ),
          ),
          react.createElement(
            "details",
            { className: "dsh-tts-advanced" },
            react.createElement("summary", null, "高级参数（一般不用改）"),
            field(
              "说话人 ID",
              num("spkId", 1, 0),
              "多说话人模型选择说话人；单说话人模型保持 0",
            ),
            field(
              "f0 方法",
              sel("f0Method", F0_OPTIONS),
              "音高检测算法：rmvpe 效果最好，pm 最快，harvest 低音好但慢",
            ),
            field(
              "变调",
              slider("f0UpKey", -12, 12, 1, semiFmt),
              "整体升降调：负值更低沉、正值更尖锐（可当声线调节）",
            ),
            field(
              "索引权重",
              slider("indexRate", 0, 1, 0.05, pctFmt),
              "越高越像模型原来的声音，越低越像你输入的原始声音（0 = 完全不用索引）",
            ),
            field(
              "输出采样率",
              selNum("resampleSr", SR_OPTIONS),
              "输出音频采样率：越高细节越好、文件越大",
            ),
            field(
              "响度混合",
              slider("rmsMixRate", 0, 1, 0.05, pctFmt),
              "输出音量包络混合比例：越高越接近模型训练者的响度习惯",
            ),
            field(
              "辅音保护",
              slider("protect", 0, 1, 0.05, pctFmt),
              "保护清辅音与呼吸声；过高会保留更多原声细节",
            ),
            field(
              "滤波半径",
              slider("filterRadius", 0, 7, 1, v => String(v)),
              "音高平滑滤波（仅 harvest 有效）：越大曲线越平滑",
            ),
            field(
              "F0 曲线文件",
              textIn("f0File", "留空 = 自动提取音高"),
              "手动指定音高曲线文件；留空自动提取",
            ),
          ),
        );
        return react.createElement(
          "div",
          { className: "dsh-tts-settings" },
          react.createElement(
            "div",
            { className: "dsh-tts-module" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                "TTS提供者",
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                "Edge TTS：免费在线音色，开箱即用；自定义音色（RVC）：用你自己训练的模型，需先启动转换服务",
              ),
            ),
            react.createElement(
              "select",
              {
                className: "dsh-tts-select",
                value: provider,
                onChange: changeProvider,
              },
              react.createElement(
                "option",
                { value: "edge-tts" },
                "Edge TTS",
              ),
              react.createElement(
                "option",
                { value: "rvc" },
                "自定义音色（RVC）",
              ),
            ),
          ),
          provider !== "rvc"
            ? react.createElement(
                "div",
                { className: "dsh-tts-module" },
                react.createElement(
                  "div",
                  { className: "dsh-tts-module-info" },
                  react.createElement(
                    "div",
                    { className: "dsh-tts-module-title" },
                    "朗读音色",
                  ),
                  react.createElement(
                    "div",
                    { className: "dsh-tts-module-desc" },
                    "选择朗读用的声音（仅 Edge TTS 模式可选）",
                  ),
                ),
                react.createElement(
                  "select",
                  {
                    className: "dsh-tts-select",
                    value: voice,
                    onChange: changeVoice,
                  },
                  voiceOptions,
                ),
              )
            : null,
          provider !== "rvc" || shared.rvc.baseSource === "edge"
            ? soundSection
            : null,
          provider === "rvc" ? rvcSection : null,
          provider === "rvc" ? packSection() : null,
          diagModule(),
          react.createElement(
            "div",
            { className: "dsh-tts-module dsh-tts-module-stack" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                "试听测试",
              ),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-preview-row" },
              react.createElement("input", {
                className: "dsh-tts-preview-input",
                value: preview,
                "aria-label": "试听文本",
                onChange: e => setPreview(e.target.value),
              }),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-preview-btn",
                  "aria-label": isPreviewPlaying ? "停止试听" : "试听",
                  title: isPreviewPlaying ? "停止试听（播放中）" : "试听",
                  onClick: onPreview,
                },
                isPreviewPlaying ? SpinnerIcon() : PlayIcon(),
              ),
            ),
            error
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-error", role: "status" },
                  error,
                )
              : null,
            isPreviewPlaying && shared.chunkProgress && shared.chunkProgress.total > 1
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-status", role: "status" },
                  "正在播放 第 " +
                    shared.chunkProgress.index +
                    "/" +
                    shared.chunkProgress.total +
                    " 段 · 后续段落边播边合成…",
                )
              : null,
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-footnote" },
            "由 Microsoft Edge TTS 驱动（node-edge-tts）。",
          ),
          picker
            ? react.createElement("div", {
                className: "dsh-tts-overlay",
                onClick: () => setPicker(null),
              })
            : null,
        );
      }
      slots.inject("settings.plugins.tab", () =>
        slots.register(
          {
            name: "settings.plugins.tab",
            id: "tts",
            order: 20,
            label: () => "语音",
          },
          VoiceSettingsPanel,
        ),
      );
    };

    exports.apply = apply;
    return module.exports;
  },
});
