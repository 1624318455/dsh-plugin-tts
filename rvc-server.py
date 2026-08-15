# rvc-server.py — local RVC voice-conversion HTTP service for dsh-plugin-tts.
#
# Runs on the user's machine with ANY RVC-Project WebUI installation (v1/v2).
# It wraps the RVC inference core (infer/modules/vc) with a tiny JSON API:
#   GET  /health                 -> service + loaded-model status
#   POST /load   { model, index? }  -> load a voice pack (model + optional index)
#   POST /convert{ audio_base64, params } -> convert an audio clip to the voice
#
# Protocol is JSON + base64 so no extra deps (python-multipart etc.) are needed.
# Input audio may be wav or mp3 (mp3 is decoded via the RVC env's bundled ffmpeg).
#
# Usage (Windows, RVC WebUI with bundled runtime):
#   E:\AI\RVC20240604Nvidia\RVC20240604Nvidia\runtime\python.exe rvc-server.py \
#       --rvc-dir "E:\AI\RVC20240604Nvidia\RVC20240604Nvidia" \
#       --model "E:\...\assets\weights\azusa-test.pth" \
#       --index "E:\...\assets\indices\azusa-test_..._v2.index" \
#       --port 4892
import argparse
import io
import os
import subprocess
import sys
import tempfile
import threading
import traceback

BASE = os.path.dirname(os.path.abspath(__file__))


def resolve_rvc_dir(value):
    if value:
        return os.path.abspath(value)
    if os.path.exists(os.path.join(BASE, "infer")):
        return BASE
    return None


ap = argparse.ArgumentParser(description="dsh-plugin-tts RVC inference server")
ap.add_argument("--port", type=int, default=4892)
ap.add_argument("--host", default="127.0.0.1")
ap.add_argument("--device", default="auto", help="cuda:0 / cpu / auto")
ap.add_argument("--fp32", action="store_true", help="force fp32 (16xx GPUs)")
ap.add_argument("--rvc-dir", default=None, help="RVC WebUI root (default: script dir if it is one)")
ap.add_argument("--model", default=None, help="preload model (.pth) path")
ap.add_argument("--index", default=None, help="preload index (.index) path")
a = ap.parse_args()

RVC_DIR = resolve_rvc_dir(a.rvc_dir)
if not RVC_DIR or not os.path.exists(os.path.join(RVC_DIR, "infer")):
    print("ERROR: cannot locate RVC WebUI root (no infer/ dir). Pass --rvc-dir.", file=sys.stderr)
    sys.exit(1)

os.chdir(RVC_DIR)
sys.path.insert(0, RVC_DIR)
os.environ.setdefault("weight_root", os.path.join(RVC_DIR, "assets", "weights"))
os.environ.setdefault("index_root", os.path.join(RVC_DIR, "assets", "indices"))
os.environ.setdefault("rmvpe_root", os.path.join(RVC_DIR, "assets", "rmvpe"))

import numpy as np
import soundfile as sf
import torch

# torch >= 2.6 defaults torch.load to weights_only=True, which breaks fairseq's
# hubert checkpoint loading (contains non-allowlisted globals). All checkpoints
# here are local + trusted (model .pth, hubert, rmvpe), so restore the legacy
# behavior. Harmless on older torch.
_orig_torch_load = torch.load


def _tts_torch_load(*args, **kwargs):
    if "weights_only" not in kwargs:
        kwargs["weights_only"] = False
    return _orig_torch_load(*args, **kwargs)


torch.load = _tts_torch_load

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from infer.modules.vc.modules import VC
from infer.modules.vc.pipeline import Pipeline
from infer.lib.infer_pack.models import (
    SynthesizerTrnMs256NSFsid,
    SynthesizerTrnMs256NSFsid_nono,
    SynthesizerTrnMs768NSFsid,
    SynthesizerTrnMs768NSFsid_nono,
)

# --- Index cache -----------------------------------------------------------
# The RVC pipeline calls faiss.read_index() + index.reconstruct_n() on EVERY
# convert, re-reading a ~400MB index file from disk each time. For chunked
# progressive playback that cost is paid per chunk, so we cache the loaded
# faiss Index objects by path (read_index is the dominant disk cost). The
# cache is cleared on every /load (the index may have changed).
try:
    import faiss as _faiss

    _orig_faiss_read = _faiss.read_index
    _faiss_index_cache = {}
    _faiss_lock = threading.Lock()

    def _cached_faiss_read(path, *args, **kwargs):
        key = os.path.abspath(str(path))
        with _faiss_lock:
            idx = _faiss_index_cache.get(key)
            if idx is None:
                idx = _orig_faiss_read(path, *args, **kwargs)
                _faiss_index_cache[key] = idx
            return idx

    _faiss.read_index = _cached_faiss_read

    def _clear_index_cache():
        with _faiss_lock:
            _faiss_index_cache.clear()

    INDEX_CACHE = True
except Exception as _ie:  # pragma: no cover - faiss always present in RVC env
    _clear_index_cache = lambda: None
    INDEX_CACHE = False
    print("faiss index cache disabled: %s" % _ie, file=sys.stderr)


def resolve_device(dev):
    if dev and dev != "auto":
        return dev
    return "cuda:0" if torch.cuda.is_available() else "cpu"


class Config:
    """Minimal config mirroring RVC configs/config.py device_config()."""

    def __init__(self, device, fp32=False):
        self.device = device
        if device.startswith("cuda"):
            self.is_half = True
            try:
                name = torch.cuda.get_device_name(int(device.split(":")[-1]))
                weak = (
                    ("16" in name and "V100" not in name.upper())
                    or "P40" in name.upper()
                    or "P10" in name.upper()
                    or "1060" in name
                    or "1070" in name
                    or "1080" in name
                )
            except Exception:
                weak = False
            if weak or fp32:
                self.is_half = False
                self.x_pad, self.x_query, self.x_center, self.x_max = 1, 6, 38, 41
            else:
                self.x_pad, self.x_query, self.x_center, self.x_max = 3, 10, 60, 65
        else:
            self.is_half = False
            self.x_pad, self.x_query, self.x_center, self.x_max = 1, 6, 38, 41


config = Config(resolve_device(a.device), fp32=a.fp32)
vc = VC(config)
app = FastAPI(title="dsh-plugin-tts RVC server")
_lock = threading.Lock()
_state = {"model": None, "index": None}


def load_model(model_path, index_path):
    model_path = os.path.abspath(str(model_path or "").strip().strip('"'))
    if not os.path.exists(model_path):
        raise HTTPException(400, "model not found: %s" % model_path)
    index_path = str(index_path or "").strip().strip('"')
    if index_path:
        index_path = os.path.abspath(index_path)
        if not os.path.exists(index_path):
            raise HTTPException(400, "index not found: %s" % index_path)

    cpt = torch.load(model_path, map_location="cpu")
    vc.cpt = cpt
    vc.tgt_sr = cpt["config"][-1]
    cpt["config"][-3] = cpt["weight"]["emb_g.weight"].shape[0]
    vc.if_f0 = cpt.get("f0", 1)
    vc.version = cpt.get("version", "v1")

    cls = {
        ("v1", 1): SynthesizerTrnMs256NSFsid,
        ("v1", 0): SynthesizerTrnMs256NSFsid_nono,
        ("v2", 1): SynthesizerTrnMs768NSFsid,
        ("v2", 0): SynthesizerTrnMs768NSFsid_nono,
    }.get((vc.version, vc.if_f0), SynthesizerTrnMs256NSFsid)

    vc.net_g = cls(*cpt["config"], is_half=config.is_half)
    del vc.net_g.enc_q
    vc.net_g.load_state_dict(cpt["weight"], strict=False)
    vc.net_g.eval().to(config.device)
    vc.net_g = vc.net_g.half() if config.is_half else vc.net_g.float()
    vc.pipeline = Pipeline(vc.tgt_sr, config)
    vc.hubert_model = None  # lazy-loaded by vc_single
    vc.index_path = index_path if index_path else ""

    _state["model"] = model_path
    _state["index"] = vc.index_path
    print("Loaded model %s (v%s, f0=%s, sr=%s, half=%s)" % (os.path.basename(model_path), vc.version, vc.if_f0, vc.tgt_sr, config.is_half), flush=True)


def decode_to_wav(data):
    """Return a wav file path for the input bytes; decodes mp3/etc via bundled ffmpeg."""
    if data[:4] == b"RIFF":
        fd, path = tempfile.mkstemp(suffix=".wav")
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return path
    src = tempfile.mktemp(suffix=".in")
    with open(src, "wb") as f:
        f.write(data)
    dst = tempfile.mktemp(suffix=".wav")
    ff = os.path.join(RVC_DIR, "ffmpeg.exe") if os.path.exists(os.path.join(RVC_DIR, "ffmpeg.exe")) else "ffmpeg"
    r = subprocess.run([ff, "-y", "-i", src, "-ac", "1", dst], capture_output=True)
    try:
        os.unlink(src)
    except OSError:
        pass
    if r.returncode != 0 or not os.path.exists(dst):
        raise HTTPException(400, "audio decode failed: %s" % r.stderr.decode("utf-8", "ignore")[-300:])
    return dst


def b64(data):
    import base64
    return base64.b64encode(data).decode("ascii")


def unb64(s):
    import base64
    return base64.b64decode(str(s))


def trim_edges(audio, sr, lead_ms=250, tail_ms=700, lead_keep_ms=20, tail_keep_ms=120, thr=0.003, fade_ms=5):
    """Trim per-chunk edge silence so chunked playback joins seamlessly.

    Edge TTS and the RVC pipeline both leave padding silence at clip edges
    (measured: ~140ms lead, ~540ms tail per chunk). Played back-to-back those
    add up to a ~680ms dead gap at every chunk boundary. Trim near-silence
    below `thr` (default -50dB), keep a short natural breath at each edge, and
    apply a tiny fade to avoid clicks.

    vc_single returns INT16 audio; integer dtypes are normalized to float
    [-1, 1] here (sf.write expects float in [-1,1] and would otherwise clip).
    Returns a float32 array in [-1, 1].
    """
    x = np.asarray(audio)
    if np.issubdtype(x.dtype, np.integer):
        info = np.iinfo(x.dtype)
        x = x.astype(np.float32) / float(info.max)
    else:
        x = x.astype(np.float32)
    n = len(x)
    if n < int(sr * 0.1):
        return x
    absx = np.abs(x)
    lead_n = min(int(sr * lead_ms / 1000), n)
    tail_n = min(int(sr * tail_ms / 1000), n)
    lead = 0
    while lead < lead_n and absx[lead] < thr:
        lead += 1
    tail = 0
    while tail < tail_n and absx[n - 1 - tail] < thr:
        tail += 1
    lead = max(0, lead - int(sr * lead_keep_ms / 1000))
    tail = max(0, tail - int(sr * tail_keep_ms / 1000))
    if lead == 0 and tail == 0:
        return x
    out = np.copy(x[lead: n - tail])
    fade_n = int(sr * fade_ms / 1000)
    if fade_n > 0 and len(out) > 2 * fade_n:
        ramp = np.linspace(0.0, 1.0, fade_n, dtype=np.float32)
        out[:fade_n] *= ramp
        out[-fade_n:] *= ramp[::-1]
    return out


@app.get("/health")
def health():
    gpu_name = None
    vram_gb = None
    if config.device.startswith("cuda") and torch.cuda.is_available():
        try:
            dev_idx = int(config.device.split(":")[-1])
            gpu_name = torch.cuda.get_device_name(dev_idx)
            vram_gb = round(torch.cuda.get_device_properties(dev_idx).total_memory / (1024 ** 3), 1)
        except Exception:
            pass
    return {
        "ok": True,
        "model_loaded": _state["model"] is not None,
        "model": os.path.basename(_state["model"]) if _state["model"] else None,
        "index": os.path.basename(_state["index"]) if _state["index"] else None,
        "device": config.device,
        "is_half": config.is_half,
        "cuda_available": torch.cuda.is_available(),
        "gpu_name": gpu_name,
        "vram_gb": vram_gb,
        "index_cache": INDEX_CACHE,
        "index_cache_entries": len(_faiss_index_cache) if INDEX_CACHE else 0,
    }


def scan_files(kind):
    """Discover local model/index files so the web UI can pick them by path."""
    exts = {".pth"} if kind == "pth" else {".index"}
    roots = [
        os.environ.get("weight_root", os.path.join(RVC_DIR, "assets", "weights")),
        os.environ.get("index_root", os.path.join(RVC_DIR, "assets", "indices")),
    ]
    logs = os.path.join(RVC_DIR, "logs")
    if os.path.isdir(logs):
        roots.append(logs)
    # the plugin's voice-pack install dir, so downloaded packs show up in the
    # browse picker (installed files are named <packId>.pth / <packId>.index)
    pack_root = os.path.expanduser(os.path.join("~", ".dsh", "tts-rvc", "packs"))
    if os.path.isdir(pack_root):
        roots.append(pack_root)
    out = []
    seen = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _, names in os.walk(root):
            for n in names:
                if os.path.splitext(n)[1].lower() in exts:
                    p = os.path.abspath(os.path.join(dirpath, n))
                    if p in seen:
                        continue
                    seen.add(p)
                    try:
                        size = os.path.getsize(p)
                    except OSError:
                        size = 0
                    out.append({"name": n, "path": p, "size": size})
    out.sort(key=lambda f: f["name"].lower())
    return out


@app.get("/files")
def files(kind: str = "pth"):
    if kind not in ("pth", "index"):
        raise HTTPException(400, "kind must be pth|index")
    return {"ok": True, "kind": kind, "files": scan_files(kind)}


@app.post("/load")
def load(payload: dict):
    with _lock:
        load_model(payload.get("model"), payload.get("index"))
        _clear_index_cache()  # index may have changed; drop cached faiss objects
    return {"ok": True, "model": _state["model"], "index": _state["index"]}


@app.post("/compact-index")
def compact_index(payload: dict):
    """Build a compact index from a big trained index.

    RVC indexes (IVF, ~hundreds of MB) are sub-sampled into a small exact flat
    index with the SAME metric as the source (RVC trains with index_factory
    which defaults to L2; the pipeline's square(1/score) weighting is built for
    L2, so a wrong metric inverts the neighbor ranking). Flat search over the
    sample is exact over the sample. Output is written next to the source (or
    into out_dir) and never overwrites it.
    """
    src = str(payload.get("index") or "").strip().strip('"')
    if not src or not os.path.exists(src):
        raise HTTPException(400, "index not found: %s" % src)
    try:
        target = int(payload.get("target_vectors", 10000))
    except (TypeError, ValueError):
        target = 10000
    target = max(500, min(target, 200000))
    out_dir = str(payload.get("out_dir") or "").strip().strip('"')
    if not out_dir:
        out_dir = os.path.dirname(os.path.abspath(src))
    out_dir = os.path.abspath(out_dir)
    with _lock:
        try:
            idx = _faiss.read_index(src)
            ntotal = int(idx.ntotal)
            d = int(idx.d)
            try:
                metric = int(getattr(idx, "metric_type", _faiss.METRIC_L2))
            except Exception:
                metric = _faiss.METRIC_L2
            src_size = os.path.getsize(src)
            if ntotal <= target:
                return {
                    "ok": True, "already_small": True,
                    "path": os.path.abspath(src),
                    "vectors": ntotal, "source_vectors": ntotal,
                    "size": src_size, "source_size": src_size,
                    "reduction_pct": 0.0,
                }
            big = idx.reconstruct_n(0, ntotal)
            rng = np.random.RandomState(42)
            sample = np.ascontiguousarray(big[rng.permutation(ntotal)[:target]], dtype="float32")
            new_idx = (
                _faiss.IndexFlatIP(d) if metric == _faiss.METRIC_INNER_PRODUCT
                else _faiss.IndexFlatL2(d)
            )
            new_idx.add(sample)
            stem = os.path.splitext(os.path.basename(src))[0]
            out_path = os.path.join(out_dir, "%s_compact_%d.index" % (stem, target))
            _faiss.write_index(new_idx, out_path)
            out_size = os.path.getsize(out_path)
            return {
                "ok": True, "path": out_path, "size": out_size,
                "vectors": target, "source_vectors": ntotal,
                "source_size": src_size,
                "reduction_pct": round((1 - out_size / src_size) * 100, 1),
            }
        except HTTPException:
            raise
        except Exception as e:
            return JSONResponse(
                status_code=500,
                content={"code": "compact_index_error",
                         "message": "%s\n%s" % (e, traceback.format_exc()[-600:])},
            )


@app.post("/convert")
def convert(payload: dict):
    if _state["model"] is None:
        raise HTTPException(400, "no model loaded; call /load first")
    audio_b64 = payload.get("audio_base64")
    if not audio_b64:
        raise HTTPException(400, "audio_base64 required")
    p = payload.get("params") or {}
    spk_id = int(p.get("spk_id", 0))
    f0_file = str(p.get("f0_file") or "").strip().strip('"')
    f0_up_key = int(p.get("f0_up_key", 0))
    f0_method = str(p.get("f0_method", "rmvpe"))
    index_rate = float(p.get("index_rate", 0.75))
    filter_radius = int(p.get("filter_radius", 3))
    resample_sr = int(p.get("resample_sr", 40000))
    rms_mix_rate = float(p.get("rms_mix_rate", 0.25))
    protect = float(p.get("protect", 0.33))

    with _lock:
        try:
            data = unb64(audio_b64)
            wav_path = decode_to_wav(data)
            try:
                # pipeline expects f0_file to be an object with a `.name` path
                f0_handle = (
                    type("F0File", (), {"name": os.path.abspath(f0_file)})()
                    if f0_file
                    else None
                )
                # file_index="" + file_index2=<index> bypasses the WebUI's
                # "trained"->"added" auto-rewrite; empty index = index-free mode.
                info, opt = vc.vc_single(
                    spk_id, wav_path, f0_up_key, f0_handle, f0_method,
                    "", _state["index"], index_rate,
                    filter_radius, resample_sr, rms_mix_rate, protect,
                )
            finally:
                try:
                    os.unlink(wav_path)
                except OSError:
                    pass
            if opt is None or opt[0] is None:
                raise HTTPException(500, "inference failed: %s" % str(info)[-500:])
            tgt_sr, audio = opt
            audio = trim_edges(audio, int(tgt_sr))
            buf = io.BytesIO()
            sf.write(buf, audio, int(tgt_sr), format="wav")
            return {"audio_base64": b64(buf.getvalue()), "sample_rate": int(tgt_sr)}
        except HTTPException:
            raise
        except Exception as e:
            return JSONResponse(
                status_code=500,
                content={"code": "inference_error", "message": "%s\n%s" % (e, traceback.format_exc()[-600:])},
            )


if a.model:
    print("Preloading model...", flush=True)
    load_model(a.model, a.index or "")

if __name__ == "__main__":
    import uvicorn
    print("dsh-plugin-tts RVC server: http://%s:%d  (device=%s, half=%s)" % (a.host, a.port, config.device, config.is_half), flush=True)
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
