# dsh-plugin-tts — Edge TTS voice integration for DeepSeek Harness

A dual-sided (Host + Web UI) DeepSeek Harness plugin that reads assistant
replies aloud using Microsoft Edge's online TTS (node-edge-tts protocol —
free, no API key).

## Features

1. **Read-aloud button** on every finalized assistant message (in the
   copy / feedback / branch action row): click to speak that message (the
   button shows an animated equalizer), click again to stop.
2. **Auto-read toggle** in the composer tool row (between the command and the
   access-mode buttons): when on, every newly completed assistant reply is
   read aloud automatically (the toggle gets a circular highlight); when off,
   nothing is auto-read.
3. **Voice settings panel** under 设置 → 插件 → 语音:
   - **TTS provider**: Edge TTS (free, no API key)
   - **Voice**: 22 live-verified Edge TTS voices (default 晓萱 zh-CN-XiaoxuanNeural)
   - **Preview**: type text and press the play (triangle) button — a spinning
     loader shows while it is synthesizing/playing (click again to stop),
     failures show an inline message.

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

## Voices (live-verified)

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
| Host | `lib/index.mjs` | Registers `POST /dsh-tts-api/speak` (synthesis) and `GET /dsh-tts-audio/<id>` (audio) webServer routes; runs a zero-dependency worker via `node -e` |
| Client | `lib/client.js` | Hidden `<audio>` host in `shell.overlay` + the three UI entries; talks to the Host through `fetch` |

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

## Troubleshooting

- **403 / `Sec-MS-GEC` rejected**: the Edge endpoint protocol or version check
  changed; update `CHROMIUM_FULL_VERSION` / `TRUSTED_CLIENT_TOKEN` inside the
  worker in `lib/index.mjs`.
- **`1007 Unsupported voice`**: the selected voice was removed from the
  endpoint; pick one from the table above.
- **No sound**: check system volume, the browser autoplay policy (interact
  with the page once), or the synthesis logs (`[tts]` errors in the `dsh web`
  console).

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
  persistence); a page refresh resets the defaults.
- Synthesized audio is written to the OS temp dir and cleaned by the OS.

## License

MIT
