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
        speaking: false,
        currentText: null,
        speakSource: null,
        speakToken: 0,
        audioEl: null,
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
          notify();
        }
      }

      function stopSpeaking() {
        shared.speakToken += 1;
        shared.speaking = false;
        shared.currentText = null;
        shared.speakSource = null;
        const el = shared.audioEl;
        if (el) {
          try {
            el.pause();
          } catch (e) {}
          try {
            el.removeAttribute("src");
          } catch (e) {}
        }
        notify();
      }

      function stopIfSource(source) {
        if (shared.speakSource === source) stopSpeaking();
      }

      async function rpcSpeak(text, voice) {
        const response = await fetch("/dsh-tts-api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });
        return await response.json();
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
        const onClick = () => {
          if (plain) speakText(plain, "manual");
        };
        return react.createElement(
          "button",
          {
            type: "button",
            className: "dsh-tts-action",
            "data-active": isPlaying || undefined,
            "aria-label": isPlaying ? "停止朗读" : "朗读本条消息",
            title: isPlaying ? "停止朗读" : "朗读本条消息",
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
                "选择消息朗读使用的语音引擎",
              ),
            ),
            react.createElement(
              "select",
              {
                className: "dsh-tts-select",
                value: shared.provider,
                onChange: () => {},
              },
              react.createElement("option", { value: "edge-tts" }, "Edge TTS"),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-module" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                "声色",
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                "选择用于语音合成的音色",
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
          ),
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
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-footnote" },
            "由 Microsoft Edge TTS 驱动（node-edge-tts）。",
          ),
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
