#!/usr/bin/env python3
"""package-runtime.py — build a portable RVC inference runtime for dsh-plugin-tts.

Strategy: copy the PROVEN package set from an existing RVC WebUI install
(runtime/ python + infer/ + hubert/rmvpe assets + ffmpeg), then optionally
upgrade torch/torchaudio to a CUDA build that supports the local GPU. This keeps
the dependency set that is known to work together and fixes the one weak point:
old torch builds (e.g. cu118 / torch 2.0) cannot run Blackwell (RTX 50-series,
sm_120) at full speed — cu128 builds include sm_120 kernels.

Works on Windows / Linux / macOS (--platform auto detects; the Linux/macOS
paths are written blind — no CI machine, test before shipping).

Result (portable folder):
    <out>/
    ├── runtime/                 # copied python env (torch optionally upgraded)
    ├── infer/                   # RVC inference core
    ├── assets/hubert/           # hubert_base.pt
    ├── assets/rmvpe/            # rmvpe.pt
    ├── ffmpeg(.exe)             # copied when available
    ├── rvc-server.py
    └── 启动服务.bat / start-rvc-server.sh

Run rvc-server.py from the portable root — it auto-detects the env
(runtime/python) and the RVC core (infer/ next to it), no WebUI needed.

Usage (Windows):
  python tools/package-runtime.py ^
      --rvc-dir "E:\\AI\\RVC20240604Nvidia\\RVC20240604Nvidia" ^
      --out "D:\\rvc-portable" [--torch cu128] [--torch-version 2.7.0]
Usage (Linux/macOS):
  python3 tools/package-runtime.py --rvc-dir /opt/RVC --out ~/rvc-portable --skip-torch
"""
import argparse
import os
import shutil
import subprocess
import sys


def detect_platform(value):
    if value and value != "auto":
        return value
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform.startswith("darwin"):
        return "darwin"
    return "linux"


def dir_gb(p):
    if not os.path.isdir(p):
        return 0.0
    total = 0
    for root, _, files in os.walk(p):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total / (1024 ** 3)


def copytree(src, dst):
    if os.path.exists(dst):
        shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def step(msg, fn):
    print("[package] %s ..." % msg, flush=True)
    fn()
    print("[package]   done", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Build a portable RVC runtime for dsh-plugin-tts")
    ap.add_argument("--rvc-dir", required=True, help="existing RVC WebUI install root")
    ap.add_argument("--out", default="rvc-portable", help="output portable folder")
    ap.add_argument("--platform", default="auto", choices=["auto", "windows", "linux", "darwin"],
                    help="target platform (auto = this machine)")
    ap.add_argument("--skip-torch", action="store_true",
                    help="skip the torch upgrade (portable works with the copied torch; "
                         "cu128 is only needed for full speed on RTX 50-series/Blackwell)")
    ap.add_argument("--torch", default="cu128", choices=["cu118", "cu121", "cu124", "cu126", "cu128"])
    ap.add_argument("--torch-version", default="2.7.0")
    ap.add_argument("--index-url", default="https://download.pytorch.org/whl",
                    help="pytorch wheel index (use a mirror if the official CDN is slow, "
                         "e.g. https://mirrors.aliyun.com/pytorch-wheels)")
    a = ap.parse_args()

    platform = detect_platform(a.platform)
    is_win = platform == "windows"
    print("[package] target platform: %s" % platform, flush=True)

    rvc = os.path.abspath(a.rvc_dir)
    out = os.path.abspath(a.out)
    runtime = os.path.join(rvc, "runtime")
    if not os.path.isdir(os.path.join(rvc, "infer")):
        sys.exit("ERROR: %s is not an RVC install (no infer/)" % rvc)
    if not os.path.isdir(runtime):
        sys.exit("ERROR: %s has no runtime/ python" % rvc)

    py_rel = os.path.join("runtime", "python.exe") if is_win else os.path.join("runtime", "bin", "python")

    os.makedirs(out, exist_ok=True)
    torch_spec = "%s+%s" % (a.torch_version, a.torch)

    step("copy runtime (%.1f GB)" % dir_gb(runtime), lambda: copytree(runtime, os.path.join(out, "runtime")))
    step("copy infer/", lambda: copytree(os.path.join(rvc, "infer"), os.path.join(out, "infer")))
    if os.path.isdir(os.path.join(rvc, "assets", "hubert")):
        step("copy assets/hubert", lambda: copytree(os.path.join(rvc, "assets", "hubert"), os.path.join(out, "assets", "hubert")))
    if os.path.isdir(os.path.join(rvc, "assets", "rmvpe")):
        step("copy assets/rmvpe", lambda: copytree(os.path.join(rvc, "assets", "rmvpe"), os.path.join(out, "assets", "rmvpe")))

    # ffmpeg: Windows uses the RVC-bundled ffmpeg.exe; elsewhere try the system
    # binary so the folder stays self-contained, otherwise fall back to PATH.
    ffmpeg_src = os.path.join(rvc, "ffmpeg.exe") if is_win else shutil.which("ffmpeg")
    if ffmpeg_src and os.path.exists(ffmpeg_src):
        fname = os.path.basename(ffmpeg_src)
        step("copy %s" % fname, lambda: shutil.copy2(ffmpeg_src, os.path.join(out, fname)))
    else:
        print("[package] WARN: no bundled ffmpeg found — rvc-server will fall back to system ffmpeg", flush=True)

    here = os.path.dirname(os.path.abspath(__file__))
    server_src = os.path.join(os.path.dirname(here), "rvc-server.py")
    if os.path.exists(server_src):
        step("copy rvc-server.py", lambda: shutil.copy2(server_src, os.path.join(out, "rvc-server.py")))
    else:
        print("[package] WARN: rvc-server.py not found next to tools/ — copy it manually", flush=True)

    py = os.path.join(out, py_rel)
    if not os.path.exists(py):
        print("[package] WARN: %s not found — check the runtime layout for platform %s" % (py_rel, platform), flush=True)

    # torch upgrade: pointless on macOS (no NVIDIA CUDA); auto-skip with a note.
    if platform == "darwin" and not a.skip_torch:
        print("[package] note: skipping torch upgrade on macOS (no CUDA); the copied torch is kept", flush=True)
    elif a.skip_torch:
        print("[package] skipping torch upgrade (--skip-torch); the portable runtime "
              "works with the copied torch (cu128 only matters for RTX 50-series speed)", flush=True)
    else:
        def upgrade_torch():
            # PyPI stays the primary index (for torch's deps like typing-extensions);
            # the pytorch index is added for the pinned +cu128 build. The local
            # version tag (==2.7.0+cu128) only matches cu128 wheels, so pip cannot
            # pick the CPU build from PyPI.
            cmd = [py, "-m", "pip", "install", "--upgrade", "--no-input",
                   "--extra-index-url", "%s/%s" % (a.index_url.rstrip("/"), a.torch),
                   "torch==%s" % torch_spec, "torchaudio==%s" % torch_spec]
            print("[package] running: %s" % " ".join(cmd), flush=True)
            subprocess.check_call(cmd)
        step("upgrade torch -> %s" % torch_spec, upgrade_torch)

    if is_win:
        launcher = os.path.join(out, "启动服务.bat")
        with open(launcher, "w", encoding="gbk", errors="replace") as f:
            f.write("@echo off\r\n"
                     "cd /d \"%~dp0\"\r\n"
                     "echo Starting dsh-plugin-tts RVC server on http://127.0.0.1:4892 ...\r\n"
                     "start \"dsh-tts-rvc\" \"%~dp0runtime\\python.exe\" \"%~dp0rvc-server.py\" --port 4892\r\n")
        print("[package] wrote %s" % launcher, flush=True)
    else:
        launcher = os.path.join(out, "start-rvc-server.sh")
        with open(launcher, "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\n"
                     "cd \"$(dirname \"$0\")\"\n"
                     "echo 'Starting dsh-plugin-tts RVC server on http://127.0.0.1:4892 ...'\n"
                     "exec \"$PWD/runtime/bin/python\" \"$PWD/rvc-server.py\" --port 4892\n")
        os.chmod(launcher, 0o755)
        print("[package] wrote %s (chmod +x)" % launcher, flush=True)

    if os.path.exists(py):
        print("[package] verifying torch...", flush=True)
        subprocess.check_call([py, "-c",
            "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), "
            "'cap', torch.cuda.get_device_capability(0) if torch.cuda.is_available() else None)"])
    total = dir_gb(out)
    print("[package] OK. Portable runtime ready: %s (%.1f GB)" % (out, total), flush=True)


if __name__ == "__main__":
    main()
