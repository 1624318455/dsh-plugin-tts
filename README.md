<p align="center">
  <img src="logo.png" alt="dsh-plugin-tts" width="140" />
</p>

<h1 align="center">dsh-plugin-tts</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22%2B-blue" alt="node"></a>
  <a href="tests/smoke.mjs"><img src="https://img.shields.io/badge/tests-68%20passed-success" alt="tests"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts"><img src="https://img.shields.io/github/stars/1624318455/dsh-plugin-tts" alt="stars"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts/commits/main"><img src="https://img.shields.io/github/last-commit/1624318455/dsh-plugin-tts" alt="last commit"></a>
</p>

## Links

- **[中文 README](README.zh.md)**（简体中文）
- **[RVC Custom Voice Guide](docs/RVC-GUIDE.md)** — custom voices · chunked progressive playback · compact index · voice packs · portable runtime
- **[User Guide (执行手册)](docs/USER-GUIDE.md)** — step-by-step, for first-time users
- **[Adaptive chunked playback design](docs/adaptive-chunked-playback.md)** — how gapless long reads work

---

# dsh-plugin-tts — Edge TTS + RVC / Index-TTS2 / Cloud voices for DeepSeek Harness

A dual-sided (Host + Web UI) DeepSeek Harness plugin that reads assistant replies
aloud — Microsoft Edge's free online TTS out of the box, **your own RVC voice
models** for custom voices, **local Index-TTS2 reference-audio voices**, or
**paid Google Cloud TTS voices** (Chinese Standard/Wavenet). Long replies stream
with **gapless adaptive chunked playback**; voices install **one-click from a
voice-pack registry**; a **portable RVC runtime** means no RVC WebUI install is needed.

> 📖 **First time? See the [user guide (执行手册)](docs/USER-GUIDE.md)** — every step
> covers "what / how / how to tell it worked": read-aloud, RVC voices and
> voice-pack downloads.

## Features

1. **Read-aloud button** on every finalized assistant message (in the
   copy / feedback / branch action row): click to speak that message (the
   button shows an animated equalizer), click again to stop.
2. **Auto-read toggle** in the composer tool row (between the command and the
   access-mode buttons): when on, every newly completed assistant reply is
   read aloud automatically (the toggle gets a circular highlight); when off,
   nothing is auto-read.
3. **Voice settings panel** under 设置 → 插件 → 语音:
   - **TTS provider**: Edge TTS (free, no API key) / custom RVC voice /
     local Index-TTS2 voice / Google Cloud TTS (paid, API key)
   - **Voice**: 22 live-verified Edge TTS voices (default 晓萱 zh-CN-XiaoxuanNeural);
     8 Cloud voices in the cmn-CN group (default cmn-CN-Wavenet-A, free-form id allowed)
   - **Sound tuning**: rate / pitch / volume (0 = default, shared by Edge & Cloud)
   - **Cloud config**: API Key (Host-file-only, write-only input) + Project ID (optional) +
     test button + this month's local usage per tier (Standard 4M / Wavenet-Neural2-Chirp3 1M)
   - **Sound tuning**: rate / pitch / volume (0 = default)
   - **Voice packs**: one-click install of voices from a registry
   - **Preview**: type text and press the play (triangle) button — a spinning
     loader shows while it is synthesizing/playing (click again to stop),
     failures show an inline message.
4. **RVC custom voices**: read with your own trained RVC models, computed
   locally (index-free mode, advanced params — see the
   [RVC guide](docs/RVC-GUIDE.md)).
5. **Gapless long reads**: adaptive chunked progressive playback — probe-calibrated
   chunk size, play-while-converting, Web Audio sample-accurate joins, no gaps
   between chunks (see the [design doc](docs/adaptive-chunked-playback.md)).
6. **Mini player** while reading: pause / resume + playback speed (1x / 1.25x /
   1.5x) on the message's action row; chunked long reads surface a visible
   "chunk x/y" counter.
7. **Themed tooltips & RVC onboarding**: hover tooltips use the app's theme
   tokens (`--dsw-*`); the RVC panel opens with a first-time 3-step guide
   (per-OS startup commands + one-click diagnostics).
8. **Download audio**: a download button on each message saves the synthesized
   audio (Edge base or RVC-converted) as an MP3 — reuses the in-session cache so
   a just-read message downloads instantly.
9. **Read selected text**: selecting text in a message shows a floating
   "朗读选中" chip — click it to read just that selection.
10. **Streaming long reads (Edge too)**: long plain-Edge reads also stream
    progressively (first chunk plays while the rest synthesize), reusing the
    gapless chunked pipeline — no more waiting for full synthesis.
11. **Approval voice alerts**: optional voice broadcast of Agent approval events.
     When enabled, an approval request (`approval/asked`) is announced aloud and
     **interrupts the current read** (the agent is waiting on the decision); an
     approval result (`approval/decided`) is announced only when idle. Alerts
     always use Edge TTS with their own alert voice (independent of the RVC
     service), are deduplicated by approval id, and off by default. (Scope note:
     task-completion announcements are deferred to a later phase — the jobs
     subsystem has no session-event channel this plugin can observe yet.)
12. **Clean reads, quiet RVC**: message Markdown (code blocks, tables, links,
    quotes, task lists) is cleaned before reading — no symbol soup; an opt-in
    "read raw Markdown symbols" toggle keeps verbatim reads for source code.
    With the Edge provider the RVC panel stays fully hidden behind a single
    "need a cloned voice?" entry, so casual reading is zero-config.

## Requirements

- DeepSeek Harness `web` profile (`dsh web`)
- Node.js >= 22 (the worker uses the native `WebSocket`)
- For **RVC custom voices only**: a local RVC inference environment (an RVC WebUI
  or the portable runtime) and a running `rvc-server.py`. macOS users: see the
  [RVC Guide](docs/RVC-GUIDE.md) → "启动本地 RVC 服务" and the
  [User Guide](docs/USER-GUIDE.md) §4.2.

## Install

```sh
# published form:
dsh plugin --profile web add "github:1624318455/dsh-plugin-tts#main"
# or local development:
dsh plugin --profile web add "file:/path/to/dsh-plugin-tts"
```

Restart `dsh web`; the plugin then loads automatically as a profile bundle.

## Voices (live-verified, Edge TTS)

| Region | Voices |
|---|---|
| Simplified Chinese | Xiaoxuan 晓萱 · Xiaoyi 晓伊 · Yunxi 云希 · Yunyang 云扬 · Xiaoxiao 晓晓 · Yunjian 云健 · Yunxia 云夏 · liaoning-Xiaobei 晓北 · shaanxi-Xiaoni 晓妮 |
| Taiwan | HsiaoChen 曉臻 · HsiaoYu 曉雨 · YunJhe 雲哲 |
| Hong Kong | HiuGaai 曉佳 · HiuMaan 曉曼 · WanLung 雲龍 |
| English | Aria · Jenny · Guy · Sonia (UK) |
| Other | Nanami 七海 (ja-JP) · SunHi (ko-KR) · Denise (fr-FR) |

> Note: legacy voices such as Xiaohan / Xiaomeng / Xiaorui / Xiaoshuang were
> removed by the Edge endpoint (`1007 Unsupported voice`) and are not listed.

## Architecture

| Layer | Location | Role |
|---|---|---|
| Host | `lib/index.mjs` | Registers `/dsh-tts-api/speak` (synthesis / chunk queue), `/dsh-tts-audio/<id>` (audio), `/dsh-tts-api/rvc-*` (RVC inference / files / compact index / voice packs) webServer routes; runs a zero-dependency worker via `node -e` |
| Client | `lib/client.js` | Hidden `<audio>` host in `shell.overlay` + the UI entries (read-aloud button / auto-read toggle / settings panel); talks to the Host through `fetch` |

The TTS worker mirrors [node-edge-tts@1.2.10](https://github.com/SchneeHertz/node-edge-tts):
`Sec-MS-GEC` query params (ticks rounded to the 5-minute boundary),
`Sec-MS-GEC-Version=1-143.0.3650.75`, `Path:audio` binary framing, `xml:lang`
derived from the voice locale, one retry on abnormal (1006) closures. Audio is
`audio-24khz-48kbitrate-mono-mp3`.

## Edge cases handled

- Clicking the read button of the message being auto-read stops it; another
  message's button switches to manual reading.
- Disabling auto-read never interrupts a manual read; it stops auto reads.
- A newly completed message (auto on) interrupts the current read; text-less
  messages are skipped; session switches only stop auto reads.
- Stopping / switching messages **eagerly cancels** the active RVC chunked job on
  the Host, so the local conversion service stops scheduling new chunks and
  releases GPU/memory promptly (no waiting for the lazy GC).
- Repeatedly reading the same text + voice **reuses the in-session audio cache**
  (no re-synthesis); if the cached backing file was cleaned by the OS, it
  transparently re-synthesizes instead of serving a stale 404 URL.
- If an Edge voice was removed by the endpoint (`1007 Unsupported voice`), the
  voice is pruned from the picker and the plugin auto-falls back to the default.
- Audio is **autoplay-unlocked** on the first user gesture (Web Audio context
  resumed + silent clip) so reads aren't silently blocked by browser policy.
- `Esc` / `S` (outside an input) stops the current read-aloud.
- Synthesis / playback failures **surface a themed toast** (message read-aloud and
  auto-read no longer fail silently; the preview panel keeps its inline error).
  In RVC mode the error toast carries a one-click **"read with Edge TTS instead"**
  action; with the opt-in toggle **"auto-switch to Edge TTS when RVC fails"** in
  the RVC settings (off by default — RVC is fully local, auto-fallback sends the
  text to Microsoft's endpoint), a failed RVC read silently retries with the RVC
  base voice via Edge TTS and shows a warn toast.
- **Smart chunking** never splits URLs / emails / decimals / versions ("3.14")
  mid-token — hard cuts slide to word/punctuation boundaries, and a tiny trailing
  sentence merges into the previous chunk instead of reading like a stutter.
- **Approval voice alerts** (opt-in): the Host subscribes to the session/event
  firehose (`approval/asked` / `approval/decided`), dedupes by approval id, and
  the client polls `/dsh-tts-api/notify?s=N` — the first poll baseline-syncs the
  cursor so a page refresh never replays stale alerts; announcements are silent
  on failure (no error toasts while the agent loops).

## Settings persistence

Layered storage:

- **Host file** (`~/.dsh/tts-rvc/settings.json`, `{ version: 1, rvc: … }`):
  service-class RVC config — service URL, model and index paths. Shared across
  browsers, survives browser-data clears and incognito. Served/updated through
  `GET /dsh-tts-api/rvc-config` + `POST /dsh-tts-api/rvc-config-save`
  (legacy `localStorage` values migrate up once, then the file wins).
- **localStorage** (`dsh-tts-settings`): UI prefs only — voice, auto-read
  toggle, provider, sound tuning, the raw-Markdown toggle, approval-alert and
  remaining RVC prefs. Never stores the service URL / model / index.

A "Reset to defaults" button in the settings panel restores defaults and clears
both layers (best-effort on the Host file).

## Custom voice (RVC)

Use your locally trained **RVC model** for voice conversion: switch the TTS
provider to "自定义音色（RVC）" in the settings panel. **First-time RVC users
need two things**: a model file (`.pth`) and a running local RVC service — see
the [RVC Guide](docs/RVC-GUIDE.md) or [User Guide](docs/USER-GUIDE.md) §4.2 for
macOS/Windows/Linux startup commands. The full story — service startup, panel
config, gapless chunked playback, compact index, voice-pack registry install,
portable runtime, settings reference and troubleshooting — lives in the
**[RVC Custom Voice Guide](docs/RVC-GUIDE.md)**.

> Public pack registry example: [rvc-for-tts](https://github.com/1624318455/rvc-for-tts)
> (设置 → 语音 → 音色包 → registry URL: `https://raw.githubusercontent.com/1624318455/rvc-for-tts/main`).

## Troubleshooting (Edge TTS)

- **403 / `Sec-MS-GEC` rejected**: the Edge endpoint protocol or version check
  changed; update `CHROMIUM_FULL_VERSION` / `TRUSTED_CLIENT_TOKEN` inside the
  worker in `lib/index.mjs`.
- **`1007 Unsupported voice`**: the selected voice was removed from the
  endpoint; pick one from the table above.
- **No sound**: check system volume, the browser autoplay policy (interact
  with the page once), or the synthesis logs (`[tts]` errors in the `dsh web`
  console).

> RVC-specific troubleshooting: [RVC Guide → Troubleshooting](docs/RVC-GUIDE.md#troubleshooting).

## FAQ

**Q: Is it big?**
- Default experience (Edge TTS): the plugin itself is tiny (MB scale) — **no service or model to download**.
- You only need a local RVC portable package if you want custom voices (RVC). Its size mostly comes from the **bundled offline Python runtime + inference deps + pretrained models**:
  | Platform | Archive | Extracted |
  |---|---:|---:|
  | macOS (Apple Silicon) | ~660 MB | ~1.3 GB |
  | Windows (CPU-minimal) | ~1–2 GB | ~2–3 GB |
  | Windows (with NVIDIA GPU) | ~6 GB | ~7 GB |
- These are self-contained runtimes; the **full RVC WebUI is 7.8 GB** — we don't ship the WebUI / training / realtime parts this plugin doesn't need.

**Q: Are the dependencies big?**
- The runtime is heavy but **you don't install anything**: the portable package bundles Python, ffmpeg (Windows) / PyAV (macOS), and all inference deps. Unzip and run — no compile, no env setup.
- The plugin itself has minimal deps and only loads what it actually uses.

**Q: Do I need a local TTS model?**
- With the default Edge TTS: **no** — it synthesizes online (free).
- With custom voices (RVC): you need **your own** RVC voice model (`.pth`), optionally a `.index`; the pretrained hubert / rmvpe are already bundled — you only provide your trained model.

**Q: Is it easy to install?**
- Install the plugin normally, then for RVC: download the portable package for your platform → unzip → run the launcher (double-click `.command` on macOS, `.bat` on Windows) → drop your `.pth` into `assets/weights` → pick it in the plugin panel.
- No compile, no manual Python/ffmpeg install. Note: **the first macOS launch is slow (tens of seconds)** while macOS scans the extracted runtimes (one-time); later launches take a few seconds.

**Q: Do I need a paid API?**
- No. Edge TTS is free (no API key) and RVC runs fully locally and free.
- Note: Edge TTS is Microsoft's public client-side, free capability — fine for personal use; check Microsoft's terms for commercial / heavy usage.

**Q: Did this modify the DSH core?**
- No. It's an **independent plugin** loaded through dsh's plugin mechanism. It doesn't touch the DSH main program and can be installed / paused / uninstalled anytime without affecting DSH or other plugins.

**Other common questions**
- **Do I need a GPU?** No — CPU works. For speed you can use Apple Silicon MPS (macOS) or an NVIDIA GPU (Windows, which needs the bigger CUDA torch build).
- **Privacy?** RVC conversion is fully local — audio never leaves your machine. Edge TTS sends the text-to-read to Microsoft's endpoint for online synthesis (assess which voice before choosing).
- **Apple Silicon only?** The macOS build is arm64 (M1–M5); Intel Macs would need a separate x86_64 build.

## UI language (i18n)

The settings panel has an **Interface language** selector at the top:
**Auto (follow browser) / 中文 / English**.
- Default "Auto" follows the browser/system language (Simplified Chinese and
  others → Chinese, everything else → English).
- Switching applies immediately and is **persisted** to localStorage
  (`dsh-tts-lang`), surviving page reloads.
- Covers the whole settings panel, bubble/read-aloud buttons, diagnostics,
  voice-pack panel, plus RVC service errors/progress hints.

## Development

```sh
node tests/smoke.mjs   # fake-ctx route registration + real Edge TTS synthesis + audio serve assertions
npm run test:all       # full: smoke + live + patch + i18n + client-load
```

Hot-reload after editing `lib/` (on Windows a `file:` install is a COPY, not a
symlink, so the running dsh reads the profile copy):

```powershell
Copy-Item lib/* $env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-external\dsh-plugin-tts\lib\ -Recurse -Force
# then refresh the browser (bundles are re-read from disk per request; never use pnpm install --force)
```

## Known limits

- Voice / auto-read toggle / provider / RVC settings are persisted in layers
  (Host file for service config, localStorage for UI prefs — see "Settings
  persistence" above) and survive refresh (see "Settings persistence" above); the
  audio cache itself is in-session only (files live in the OS temp dir, cleaned
  by the OS), so a full restart re-synthesizes the first read of each text.
- Synthesized audio is written to the OS temp dir and cleaned by the OS.
- zh/en **layout/visual** fitting (English text is longer; may wrap/overflow; theme
  vars `--dsw-*`) must be eyeballed in the real dsh UI with the plugin loaded — this
  plugin ships no standalone HTML (its UI is slot-injected by the dsh web host), so
  it cannot be headless-screenshotted here (`tests/client-load.mjs` asserts the
  in-memory render only, not real DOM/CSS).

## License

MIT
