#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mock GPT-SoVITS api_v2.py —— 只实现 POST /tts，返回一段 WAV。

用途：本机没起 GPT-SoVITS 时，用它顶替引擎，配合
tools/gpt-sovits-openai-gateway.py 验证「插件 -> 网关 -> 上游」整条链路。
它不做任何合成，返回的是固定时长的静音，只保证容器/字段/错误路径是真的。

  python tools/mock-sovits-upstream.py --port 18081

日志会打印收到的 text / ref_audio_path / top_k 等，便于确认 extraBody 是否透传。
"""
import argparse
import io
import json
import sys
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def make_wav(seconds=2.0, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        if self.path.split("?")[0] != "/tts":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            body = {}
        if not isinstance(body, dict) or not str(body.get("text") or "").strip():
            payload = b'{"detail":"text is required"}'
            self.send_response(422)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        sys.stderr.write("[mock-sovits] text=%r ref=%s top_k=%s speed=%s\n" % (
            str(body.get("text"))[:40], body.get("ref_audio_path"), body.get("top_k"),
            body.get("speed_factor")))
        sys.stderr.flush()
        wav = make_wav()
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            body = b'{"ok":true,"mock":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=18081)
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stderr.write("[mock-sovits] listening http://%s:%d/tts\n" % (args.host, args.port))
    sys.stderr.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
