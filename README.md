<p align="center">
  <img src="logo.png" alt="dsh-plugin-tts" width="140" />
</p>

<h1 align="center">dsh-plugin-tts</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22%2B-blue" alt="node"></a>
  <a href="tests/smoke.mjs"><img src="https://img.shields.io/badge/tests-37%20passed-success" alt="tests"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts"><img src="https://img.shields.io/github/stars/1624318455/dsh-plugin-tts" alt="stars"></a>
  <a href="https://github.com/1624318455/dsh-plugin-tts/commits/main"><img src="https://img.shields.io/github/last-commit/1624318455/dsh-plugin-tts" alt="last commit"></a>
</p>

## Links

- **[中文 README](README.zh.md)**（简体中文）
- **[RVC Custom Voice Guide](docs/RVC-GUIDE.md)** — custom voices · chunked progressive playback · compact index · voice packs · portable runtime
- **[User Guide (执行手册)](docs/USER-GUIDE.md)** — step-by-step, for first-time users
- **[Adaptive chunked playback design](docs/adaptive-chunked-playback.md)** — how gapless long reads work

---

# dsh-plugin-tts — Edge TTS + RVC voice for DeepSeek Harness

A dual-sided (Host + Web UI) DeepSeek Harness plugin that reads assistant replies
aloud — Microsoft Edge's free online TTS out of the box, or **your own RVC voice
models** for custom voices. Long replies stream with **gapless adaptive chunked
playback**; voices install **one-click from a voice-pack registry**; a **portable
RVC runtime** means no RVC WebUI install is needed.

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
   - **TTS provider**: Edge TTS (free, no API key) / custom RVC voice
   - **Voice**: 22 live-verified Edge TTS voices (default 晓萱 zh-CN-XiaoxuanNeural)
   - **Sound tuning**: rate / pitch / volume (0 = default)
   - **Voice packs**: one-click install of voices from a registry
   - **Preview**: type text and press the play (triangle) button — a spinning
     loader shows while it is synthesizing/playing (click again to stop),
     failures show an inline message.
4. **RVC custom voices**: read with your own trained RVC models, computed
   locally (upload base audio, index-free mode, advanced params — see the
   [RVC guide](docs/RVC-GUIDE.md)).
5. **Gapless long reads**: adaptive chunked progressive playback — probe-calibrated
   chunk size, play-while-converting, Web Audio sample-accurate joins, no gaps
   between chunks (see the [design doc](docs/adaptive-chunked-playback.md)).

## Requirements

- DeepSeek Harness `web` profile (`dsh web`)
- Node.js >= 22 (the worker uses the native `WebSocket`)

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
- Synthesis / playback failures silently reset the icon state (the preview
  panel shows an inline error message).

## Custom voice (RVC)

Use your locally trained **RVC model** for voice conversion: switch the TTS
provider to "自定义音色（RVC）" in the settings panel. The full story — service
startup, panel config, gapless chunked playback, compact index, voice-pack
registry install, portable runtime, settings reference and troubleshooting —
lives in the **[RVC Custom Voice Guide](docs/RVC-GUIDE.md)**.

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

## Development

```sh
node tests/smoke.mjs   # fake-ctx route registration + real Edge TTS synthesis + audio serve assertions
```

Hot-reload after editing `lib/` (on Windows a `file:` install is a COPY, not a
symlink, so the running dsh reads the profile copy):

```powershell
Copy-Item lib/* $env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-external\dsh-plugin-tts\lib\ -Recurse -Force
# then refresh the browser (bundles are re-read from disk per request; never use pnpm install --force)
```

## Known limits

- Voice / auto-read toggle state is in-memory (dynamic settings, no disk
  persistence); a page refresh resets the defaults. Voice-pack settings
  (registry URL / proxy / in-flight download) are remembered in localStorage.
- Synthesized audio is written to the OS temp dir and cleaned by the OS.

## License

MIT
