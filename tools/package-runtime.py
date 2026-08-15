#!/usr/bin/env python3
"""package-runtime.py — build a portable RVC inference runtime for dsh-plugin-tts.

Strategy: copy the PROVEN package set from an existing RVC WebUI install
(runtime/ python + infer/ + hubert/rmvpe assets + ffmpeg), then upgrade ONLY
torch/torchaudio to a CUDA build that supports the local GPU. This keeps the
dependency set that is known to work together and fixes the one weak point:
old torch builds (e.g. cu118 / torch 2.0) cannot run Blackwell (RTX 50-series,
sm_120) at full speed — cu128 builds include sm_120 kernels.

Result (portable folder):
    <out>/
    ├── runtime/                 # copied python env (torch upgraded)
    ├── infer/                   # RVC inference core
    ├── assets/hubert/           # hubert_base.pt
    ├── assets/rmvpe/            # rmvpe.pt
    ├── ffmpeg.exe
    ├── rvc-server.py
    └── 启动服务.bat

Run rvc-server.py from the portable root — it auto-detects the env
(runtime/python.exe) and the RVC core (infer/ next to it), no WebUI needed.

Usage:
  python tools/package-runtime.py ^
      --rvc-dir "E:\\AI\\RVC20240604Nvidia\\RVC20240604Nvidia" ^
      --out "D:\\rvc-portable" [--torch cu128] [--torch-version 2.7.0]
"""
import argparse
import os
import shutil
import subprocess
import sys


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
    ap.add_argument("--skip-torch", action="store_true",
                    help="skip the torch upgrade (portable works with the copied torch; "
                         "cu128 is only needed for full speed on RTX 50-series/Blackwell)")
    ap.add_argument("--torch", default="cu128", choices=["cu118", "cu121", "cu124", "cu126", "cu128"])
    ap.add_argument("--torch-version", default="2.7.0")
    ap.add_argument("--index-url", default="https://download.pytorch.org/whl",
                    help="pytorch wheel index (use a mirror if the official CDN is slow, "
                         "e.g. https://mirrors.aliyun.com/pytorch-wheels)")
    a = ap.parse_args()

    rvc = os.path.abspath(a.rvc_dir)
    out = os.path.abspath(a.out)
    runtime = os.path.join(rvc, "runtime")
    if not os.path.isdir(os.path.join(rvc, "infer")):
        sys.exit("ERROR: %s is not an RVC install (no infer/)" % rvc)
    if not os.path.isdir(runtime):
        sys.exit("ERROR: %s has no runtime/ python" % rvc)
    if not os.path.exists(os.path.join(rvc, "ffmpeg.exe")):
        print("WARN: no ffmpeg.exe in RVC dir — mp3 base audio decode will fall back to system ffmpeg", flush=True)

    os.makedirs(out, exist_ok=True)
    torch_spec = "%s+%s" % (a.torch_version, a.torch)

    step("copy runtime (%.1f GB)" % dir_gb(runtime), lambda: copytree(runtime, os.path.join(out, "runtime")))
    step("copy infer/", lambda: copytree(os.path.join(rvc, "infer"), os.path.join(out, "infer")))
    if os.path.isdir(os.path.join(rvc, "assets", "hubert")):
        step("copy assets/hubert", lambda: copytree(os.path.join(rvc, "assets", "hubert"), os.path.join(out, "assets", "hubert")))
    if os.path.isdir(os.path.join(rvc, "assets", "rmvpe")):
        step("copy assets/rmvpe", lambda: copytree(os.path.join(rvc, "assets", "rmvpe"), os.path.join(out, "assets", "rmvpe")))
    if os.path.exists(os.path.join(rvc, "ffmpeg.exe")):
        step("copy ffmpeg.exe", lambda: shutil.copy2(os.path.join(rvc, "ffmpeg.exe"), os.path.join(out, "ffmpeg.exe")))
    here = os.path.dirname(os.path.abspath(__file__))
    server_src = os.path.join(os.path.dirname(here), "rvc-server.py")
    if os.path.exists(server_src):
        step("copy rvc-server.py", lambda: shutil.copy2(server_src, os.path.join(out, "rvc-server.py")))
    else:
        print("[package] WARN: rvc-server.py not found next to tools/ — copy it manually", flush=True)

    py = os.path.join(out, "runtime", "python.exe")
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
    if a.skip_torch:
        print("[package] skipping torch upgrade (--skip-torch); the portable runtime "
              "works with the copied torch (cu128 only matters for RTX 50-series speed)", flush=True)
    else:
        step("upgrade torch -> %s" % torch_spec, upgrade_torch)

    bat = os.path.join(out, "启动服务.bat")
    with open(bat, "w", encoding="gbk", errors="replace") as f:
        f.write("@echo off\r\n"
                 "cd /d \"%~dp0\"\r\n"
                 "echo Starting dsh-plugin-tts RVC server on http://127.0.0.1:4892 ...\r\n"
                 "start \"dsh-tts-rvc\" \"%~dp0runtime\\python.exe\" \"%~dp0rvc-server.py\" --port 4892\r\n")
    print("[package] wrote %s" % bat, flush=True)

    print("[package] verifying torch...", flush=True)
    subprocess.check_call([py, "-c",
        "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), "
        "'cap', torch.cuda.get_device_capability(0) if torch.cuda.is_available() else None)"])
    total = dir_gb(out)
    print("[package] OK. Portable runtime ready: %s (%.1f GB)" % (out, total), flush=True)


if __name__ == "__main__":
    main()
