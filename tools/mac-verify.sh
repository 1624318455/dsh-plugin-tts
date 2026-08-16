#!/bin/bash
# mac-verify.sh — end-to-end verification of the dsh-plugin-tts RVC server on macOS.
#
# Checks, in order:
#   1. GET  /health                      server up + device/CPU info
#   2. GET  /files?kind=pth              model discovery
#   3. POST /load                        load the voice model (+ optional index)
#   4. POST /convert                     real conversion of synthesized speech
#   5. output file sanity (RIFF/duration)
#   6. POST /compact-index               (only when an index is given)
#
# Usage: bash mac-verify.sh <model.pth> [index.index] [host:port]
#   PY env var overrides the python used for JSON/base64 (default python3 —
#   use the rvc-work venv python:  ~/rvc-work/venv/bin/python)
#
# Exit code 0 = all checks passed; otherwise the failing step's exit code.
set -u

MODEL="${1:-}"
INDEX="${2:-}"
HOST="${3:-127.0.0.1:4892}"
BASE="http://$HOST"
PY="${PY:-python3}"
FAIL=0

if [ -z "$MODEL" ]; then
  echo "usage: bash mac-verify.sh <model.pth> [index.index] [host:port]"
  exit 2
fi
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "ERROR: python not found: $PY (set PY=.../venv/bin/python)"
  exit 2
fi
echo "== target: $BASE  model: $MODEL  index: ${INDEX:-<none>}  py: $PY =="

step() { echo; echo "== [$1/6] $2 =="; }

step 1 "/health"
curl -sS --max-time 15 "$BASE/health" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
print(json.dumps(d, ensure_ascii=False, indent=1))
assert d.get("ok") is True, "health ok != true"
assert d.get("device") == "cpu", "expected cpu device on macOS, got %r" % d.get("device")
assert d.get("cuda_available") is False, "cuda must not be available on macOS"
' || FAIL=1

step 2 "/files?kind=pth"
curl -sS --max-time 15 "$BASE/files?kind=pth" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
files = d.get("files", [])
print("discovered %d .pth files" % len(files))
for f in files[:5]:
    print("  ", f["name"], f["size"])
' || FAIL=1

step 3 "/load"
"$PY" - "$BASE" "$MODEL" "$INDEX" <<'PYEOF' || FAIL=1
import json, sys, urllib.request
base, model, index = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"model": model}
if index:
    payload["index"] = index
req = urllib.request.Request(base + "/load",
                             data=json.dumps(payload).encode(),
                             headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        print(json.dumps(json.load(r), ensure_ascii=False))
except urllib.error.HTTPError as e:
    print("load HTTP %s: %s" % (e.code, e.read().decode("utf-8", "ignore")[:600]))
    sys.exit(1)
PYEOF

step 4 "/convert (real speech -> converted wav)"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
if command -v say >/dev/null 2>&1; then
  say -o "$TMPD/speech.aiff" "你好，这是一段跨平台语音转换测试。" 2>/dev/null \
    && ffmpeg -y -loglevel error -i "$TMPD/speech.aiff" -ac 1 -ar 44100 "$TMPD/speech.wav"
fi
if [ ! -s "$TMPD/speech.wav" ]; then
  echo "note: say/ffmpeg failed, synthesizing a 3s tone instead"
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=3" -ac 1 -ar 44100 "$TMPD/speech.wav"
fi
ls -l "$TMPD/speech.wav"
"$PY" - "$BASE" "$TMPD/speech.wav" "$TMPD/out.wav" <<'PYEOF' || FAIL=1
import base64, json, sys, time, urllib.request
base, wav, out = sys.argv[1], sys.argv[2], sys.argv[3]
data = open(wav, "rb").read()
payload = {
    "audio_base64": base64.b64encode(data).decode("ascii"),
    "params": {"f0_method": "rmvpe", "index_rate": 0.75},
}
t0 = time.time()
req = urllib.request.Request(base + "/convert",
                             data=json.dumps(payload).encode(),
                             headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=900) as r:
        resp = json.load(r)
except urllib.error.HTTPError as e:
    print("convert HTTP %s: %s" % (e.code, e.read().decode("utf-8", "ignore")[:800]))
    sys.exit(1)
wall = time.time() - t0
out_b64 = resp.get("audio_base64")
if not out_b64:
    print("CONVERT FAILED (no audio in response):", json.dumps(resp, ensure_ascii=False)[:600])
    sys.exit(1)
open(out, "wb").write(base64.b64decode(out_b64))
sr = int(resp.get("sample_rate", 0))
in_sec = len(data) / 2.0 / 44100.0
print("convert ok: wall=%.1fs  sample_rate=%s  out=%s  (%.2fx realtime)" % (wall, sr, out, wall / max(in_sec, 0.01)))
PYEOF

step 5 "output sanity (RIFF + duration)"
# RIFF magic check. NB: macOS `od -An -tx1` pads bytes with *two* spaces
# ("52  49  46  46") while GNU `od` uses one ("52 49 46 46"), so a literal
# "52 49 46 46" grep wrongly fails on macOS even for a valid RIFF file.
# Strip whitespace and compare the raw hex instead (portable across both).
if command -v xxd >/dev/null 2>&1; then
  MAGIC="$(head -c 4 "$TMPD/out.wav" | xxd -p | tr -d '[:space:]')"
else
  MAGIC="$(head -c 4 "$TMPD/out.wav" | od -An -tx1 | tr -d '[:space:]')"
fi
if [ "$MAGIC" != "52494646" ]; then echo "FAIL: not a RIFF file"; FAIL=1; fi
if command -v ffprobe >/dev/null 2>&1; then
  DUR="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TMPD/out.wav" 2>/dev/null)"
  echo "out.wav duration: ${DUR:-unknown}s (input speech was ~3s)"
fi

if [ -n "$INDEX" ]; then
  step 6 "/compact-index"
  "$PY" - "$BASE" "$INDEX" <<'PYEOF' || FAIL=1
import json, sys, urllib.request
base, idx = sys.argv[1], sys.argv[2]
req = urllib.request.Request(base + "/compact-index",
                             data=json.dumps({"index": idx, "target_vectors": 2000}).encode(),
                             headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=900) as r:
        print(json.dumps(json.load(r), ensure_ascii=False, indent=1))
except urllib.error.HTTPError as e:
    print("compact-index HTTP %s: %s" % (e.code, e.read().decode("utf-8", "ignore")[:600]))
    sys.exit(1)
PYEOF
else
  step 6 "skipped (/compact-index needs an index path)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED (macOS)"
else
  echo "SOME CHECKS FAILED — see output above"
fi
exit "$FAIL"
