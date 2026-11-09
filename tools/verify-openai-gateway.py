# -*- coding: utf-8 -*-
"""自检：mock api_v2 + 真网关，验证 OpenAI 请求 -> GPT-SoVITS payload 映射。

覆盖三类：
  1) 协议映射（input/voice/response_format/speed -> gpt-sovits 字段）
  2) extraBody 透传（含覆盖网关默认值）
  3) 上游异常（HTTP 500 / 200 却是 JSON）必须变成可读的 502，而不是假成功
"""
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
GATEWAY = os.path.join(HERE, "gpt-sovits-openai-gateway.py")
CAPTURED = {}


def make_wav(seconds=1.0, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


WAV = make_wav()


def free_port():
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


class MockUpstream(BaseHTTPRequestHandler):
    """mode: wav（正常）/ 500（上游报错）/ json200（200 但不是音频）"""
    mode = "wav"
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        try:
            CAPTURED["body"] = json.loads(raw.decode("utf-8"))
        except ValueError:
            CAPTURED["body"] = None
        if MockUpstream.mode == "500":
            return self._send(500, "application/json", b'{"detail":"CUDA out of memory"}')
        if MockUpstream.mode == "json200":
            return self._send(200, "application/json", b'{"code":400,"message":"ref audio not found"}')
        return self._send(200, "audio/wav", WAV)


# 自检全在本机跑：绝不能继承 HTTP_PROXY，否则开了代理的机器上会被劫持，
# 断言错误地失败（或错误地通过）。
NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(url, body, timeout=20):
    payload = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json"})
    try:
        with NO_PROXY.open(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()


def main():
    up = ThreadingHTTPServer(("127.0.0.1", 0), MockUpstream)
    up_port = up.server_address[1]
    threading.Thread(target=up.serve_forever, daemon=True).start()

    tmpdir = tempfile.mkdtemp(prefix="dsh-gw-selftest-")
    ref = os.path.join(tmpdir, "ref.wav")
    with open(ref, "wb") as f:
        f.write(WAV)
    voices = os.path.join(tmpdir, "voices.json")
    with open(voices, "w", encoding="utf-8") as f:
        json.dump({
            "默认": {"ref_audio": ref, "prompt_text": "这是参考音频的文字", "prompt_lang": "zh"},
            "角色B": {"ref_audio": ref, "prompt_text": "第二段参考文本", "prompt_lang": "zh"},
        }, f, ensure_ascii=False)

    gw_port = free_port()
    proc = subprocess.Popen(
        [sys.executable, GATEWAY, "--upstream", "http://127.0.0.1:%d" % up_port,
         "--voices", voices, "--port", str(gw_port), "--model-id", "gpt-sovits"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    base = "http://127.0.0.1:%d" % gw_port
    fails = 0

    def check(name, ok, extra=""):
        nonlocal fails
        print(("PASS  " if ok else "FAIL  ") + name + (" — " + str(extra)[:180] if extra else ""))
        if not ok:
            fails += 1

    try:
        for _ in range(80):
            try:
                NO_PROXY.open(base + "/health", timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)

        with NO_PROXY.open(base + "/health", timeout=5) as r:
            health = json.loads(r.read().decode("utf-8"))
        check("GET /health lists the configured voices",
              health.get("ok") is True and set(health.get("voices") or []) == {"默认", "角色B"}, health)

        with NO_PROXY.open(base + "/v1/models", timeout=5) as r:
            models = json.loads(r.read().decode("utf-8"))
        check("GET /v1/models lists the model",
              models.get("data") and models["data"][0]["id"] == "gpt-sovits", models)

        code, ctype, data = post(base + "/v1/audio/speech", {
            "model": "gpt-sovits", "voice": "角色B", "input": "你好世界",
            "response_format": "wav", "speed": 1.25,
            "top_k": 7, "emo_weight": 0.6, "text_split_method": "cut5",
        })
        check("POST /v1/audio/speech -> 200 audio/wav",
              code == 200 and ctype.startswith("audio/wav") and data[:4] == b"RIFF", "%s %s %d bytes" % (code, ctype, len(data)))
        got = CAPTURED.get("body") or {}
        check("maps input -> text", got.get("text") == "你好世界", got.get("text"))
        check("maps response_format -> media_type", got.get("media_type") == "wav", got.get("media_type"))
        check("maps speed -> speed_factor", abs(float(got.get("speed_factor", 0)) - 1.25) < 1e-6, got.get("speed_factor"))
        check("voice name resolves to that voice's ref audio + prompt",
              os.path.basename(got.get("ref_audio_path") or "") == "ref.wav" and got.get("prompt_text") == "第二段参考文本",
              got.get("prompt_text"))
        check("extraBody passthrough (top_k/emo_weight)",
              got.get("top_k") == 7 and got.get("emo_weight") == 0.6, {k: got.get(k) for k in ("top_k", "emo_weight")})
        check("OpenAI-only keys are not forwarded",
              "input" not in got and "response_format" not in got and "voice" not in got,
              [k for k in ("input", "response_format", "voice") if k in got])
        check("sampling defaults filled in", got.get("repetition_penalty") == 1.35 and got.get("parallel_infer") is True, got.get("repetition_penalty"))

        code2, ctype2, data2 = post(base + "/v1/audio/speech", {
            "voice": "alloy", "input": "回退到默认音色", "response_format": "wav"})
        check("unknown voice falls back to the default voice",
              code2 == 200 and (CAPTURED.get("body") or {}).get("prompt_text") == "这是参考音频的文字",
              (CAPTURED.get("body") or {}).get("prompt_text"))

        # extraBody may override a gateway default or a protocol-derived field
        post(base + "/v1/audio/speech", {
            "voice": "默认", "input": "覆盖默认参数", "response_format": "wav",
            "speed": 9, "text_lang": "ja", "top_k": 3})
        got = CAPTURED.get("body") or {}
        check("speed is clamped to 4.0 upstream", abs(float(got.get("speed_factor", 0)) - 4.0) < 1e-6, got.get("speed_factor"))
        check("extraBody text_lang override survives", got.get("text_lang") == "ja", got.get("text_lang"))
        check("extraBody overrides a sampling default", got.get("top_k") == 3, got.get("top_k"))

        # --- 切分策略：默认按文本自动选，不再写死 cut5 -------------------
        # 写死 cut5 会把最后半句拆成独立短段，GPT-SoVITS 在该段 EOS 提前收尾，
        # 听感就是句尾气口没说完就断了。实测见 gateway 里的「切分策略」注释。
        import importlib.util
        spec = importlib.util.spec_from_file_location("gw_under_test", GATEWAY)
        gw = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gw)
        check("split: 单句 -> cut0", gw.pick_split_method("你好，这是一个语音测试。") == "cut0")
        check("split: 多句 -> cut1", gw.pick_split_method("你好。今天天气不错，我们试试。") == "cut1")
        check("split: 超长 -> cut5", gw.pick_split_method("字" * (gw.SPLIT_AUTO_MAX_CHARS + 1)) == "cut5")
        check("split: 英文多句 -> cut1", gw.pick_split_method("Hello there. This is a test.") == "cut1")
        check("split: 无句末标点 -> cut0", gw.pick_split_method("你好世界") == "cut0")
        check("split: --split-method 强制优先", gw.pick_split_method("你好", "cut2") == "cut2")

        post(base + "/v1/audio/speech", {"voice": "默认", "input": "单句请求。"})
        got = CAPTURED.get("body") or {}
        check("单句请求默认下发 cut0", got.get("text_split_method") == "cut0", got.get("text_split_method"))
        post(base + "/v1/audio/speech", {"voice": "默认", "input": "第一句。第二句。"})
        got = CAPTURED.get("body") or {}
        check("多句请求默认下发 cut1", got.get("text_split_method") == "cut1", got.get("text_split_method"))

        code3, _, body3 = post(base + "/v1/audio/speech", {"voice": "默认", "input": "  "})
        check("empty input -> 400", code3 == 400, body3[:120])

        code4, _, body4 = post(base + "/v1/audio/speech", b"{}")
        check("garbage body handled without crashing", code4 in (400, 500), body4[:120])

        code5, _, body5 = post(base + "/v1/audio/speech", b"[]")
        check("JSON array body -> 400", code5 == 400, body5[:120])

        # --- upstream failures must not look like success -----------------
        MockUpstream.mode = "500"
        code6, ctype6, body6 = post(base + "/v1/audio/speech", {"voice": "默认", "input": "上游报错"})
        check("upstream HTTP 500 -> gateway 502 with the upstream detail",
              code6 == 502 and "CUDA out of memory" in body6.decode("utf-8", "replace"), "%s %s" % (code6, body6[:120]))

        MockUpstream.mode = "json200"
        code7, ctype7, body7 = post(base + "/v1/audio/speech", {"voice": "默认", "input": "上游 200 但不是音频"})
        check("upstream 200+JSON -> gateway 502, never audio",
              code7 == 502 and "不是音频" in body7.decode("utf-8", "replace"), "%s %s" % (code7, body7[:140]))
        MockUpstream.mode = "wav"

        # --- 系统代理不得劫持本机请求 -------------------------------------
        # Windows 上开着 Clash/V2Ray 时会全局设置 HTTP_PROXY。urllib 默认照单全收，
        # 连 127.0.0.1 也发给代理，结果是多一跳、并且上游没起来时拿到代理的 502
        # 而不是"连接被拒"。这里把代指向一个死端口，网关必须照常工作。
        gw2_port = free_port()
        dead_proxy = "http://127.0.0.1:1"
        env2 = dict(os.environ)
        env2.update({"HTTP_PROXY": dead_proxy, "HTTPS_PROXY": dead_proxy,
                     "http_proxy": dead_proxy, "https_proxy": dead_proxy})
        env2.pop("NO_PROXY", None)
        env2.pop("no_proxy", None)
        proc2 = subprocess.Popen(
            [sys.executable, GATEWAY, "--upstream", "http://127.0.0.1:%d" % up_port,
             "--voices", voices, "--port", str(gw2_port), "--model-id", "gpt-sovits"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env2,
        )
        try:
            base2 = "http://127.0.0.1:%d" % gw2_port
            for _ in range(80):
                try:
                    NO_PROXY.open(base2 + "/health", timeout=1).read()
                    break
                except Exception:
                    time.sleep(0.1)
            code8, ctype8, _ = post(base2 + "/v1/audio/speech",
                                    {"voice": "默认", "input": "代理劫持回归测试"})
            check("loopback upstream ignores HTTP_PROXY (dead proxy still works)",
                  code8 == 200 and ctype8.startswith("audio/wav"), "%s %s" % (code8, ctype8))
        finally:
            proc2.terminate()
            try:
                proc2.communicate(timeout=5)
            except Exception:
                proc2.kill()
    finally:
        proc.terminate()
        try:
            _, err = proc.communicate(timeout=5)
        except Exception:
            proc.kill()
            err = b""
        up.shutdown()
        for p in (ref, voices):
            try:
                os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass
        if fails:
            print("\n--- gateway stderr ---")
            print(err.decode("utf-8", "replace")[-1500:])

    print(("\n%d checks failed" % fails) if fails else "\n全部通过")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
