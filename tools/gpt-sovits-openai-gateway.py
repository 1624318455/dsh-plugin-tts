#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gpt-sovits-openai-gateway — 把 GPT-SoVITS 的 api_v2.py 包成 OpenAI 兼容的
/v1/audio/speech 端点，供 dsh-plugin-tts 的「OpenAI 兼容」提供者直连。

为什么需要这一层：
  GPT-SoVITS 的 Gradio WebUI 没有 HTTP 接口；同目录下的 api_v2.py 有 /tts，
  但入参是 gpt-sovits 自己的形状（ref_audio_path / prompt_text / top_k / …），
  不是 OpenAI 的 {model, voice, input, response_format}。插件只发 OpenAI 字段，
  引擎私有参数走 extraBody 平铺进请求体 —— 本脚本负责把两者接起来。

零第三方依赖（只用标准库），任何 python3.8+ 都能跑。

用法（Windows 示例）：
  python gpt-sovits-openai-gateway.py ^
    --upstream http://127.0.0.1:9881 ^
    --ref-audio "<参考音频.wav>" ^
    --prompt-text "参考音频里说的那句话" ^
    --prompt-lang zh --text-lang zh --port 8000

  # 多个角色音色（插件里 voice 填名称即可切换）：
  python gpt-sovits-openai-gateway.py --voices voices.json --port 8000

  voices.json:
  {
    "默认":  {"ref_audio": "D:/refs/a.wav", "prompt_text": "……", "prompt_lang": "zh"},
    "角色B": {"ref_audio": "D:/refs/b.wav", "prompt_text": "……", "prompt_lang": "zh"}
  }

  voice 的解析顺序：
    1) 正好命中 voices.json 里的名字 -> 用那一套
    2) 是一个存在的音频文件路径 -> 直接用（prompt_text 取 --prompt-text）
    3) 其它（如 "alloy"/"default"）-> 用命令行给的默认参考音频

  extraBody 透传：请求体里除 model/voice/input/response_format/speed 之外的
  任何键都会原样并进 GPT-SoVITS 的 payload（例如 top_k、text_split_method、
  repetition_penalty、emo_* 之类），所以插件侧「高级参数」能直接生效。

  切分策略（text_split_method）：默认自动，不写死 cut5。
    插件已经把文本按 15 秒切好块了，网关再按标点细切就是二次切分 ——
    最后半句会被单独合成，句尾气口没收完就断。
      ≤1 句   -> cut0（整句一次合成）
      多句    -> cut1（按句切，句子内部连贯、句间保留自然停顿）
      >120 字 -> cut5（超长段才标点级细切）
    想强制某个档位：--split-method cut5
    也可以在插件「高级参数」里填 {"text_split_method":"cut5"} 单次覆盖。
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# OpenAI 协议字段，不往上游传
OPENAI_KEYS = {"model", "voice", "input", "response_format", "speed", "stream", "extra_body"}
# 本脚本自己消费、也不往上游传的键
GATEWAY_KEYS = {"ref_audio", "ref_audio_path", "prompt_text", "prompt_lang", "text_lang"}

DEFAULTS = {
    "text_lang": "zh",
    "prompt_lang": "zh",
    "prompt_text": "",
    "ref_audio": "",
}

# GPT-SoVITS /tts 的标准采样参数（插件不传时的兜底）
# 注意：text_split_method 不在这里写死，由 pick_split_method() 按文本决定 ——
# 见下方「切分策略」注释。
SAMPLING = {
    "top_k": 15,
    "top_p": 1.0,
    "temperature": 1.0,
    "batch_size": 1,
    "seed": 42,
    "parallel_infer": True,
    "repetition_penalty": 1.35,
}

# --- 切分策略 -------------------------------------------------------------
# 插件自己已经按 15 秒把文本切成块了（Host 侧 chunkSec ≈ 15s，中文约 54 字），
# 每个请求本来就是一段短文本。网关再写死 cut5（按标点细切）等于二次切分：
# 句子被拆成独立合成的短段，每一段都重新起调、各自在 EOS 收尾，最后半句往
# 往被切成一个孤零零的短段 —— 听感就是句尾气口没说完就断了。
# 实测（NVIDIA GPU + V4 整合包，「你好，这是一个语音测试。」）：
#   cut5  总长 2.280s，语音结束 1.875s，尾部静音 405ms，句间硬插 ~380ms
#   cut0  总长 2.320s，语音结束 2.059s，尾部静音 261ms  ← 尾音完整
# 所以默认改成按文本长度/句数自动选：
#   ≤1 句      -> cut0（整句一次合成，语调连贯，尾音完整）
#   多句       -> cut1（按句切：句子内部连贯，句间保留自然停顿，不做标点级碎裂）
#   >120 字    -> cut5（只有超长段才需要标点级细切兜住显存/稳定性）
# extraBody 里的 text_split_method 仍然优先（最后写入 payload，可随时覆盖）。
SPLIT_AUTO_MAX_CHARS = 120
CUT_METHODS = ("cut0", "cut1", "cut2", "cut3", "cut4", "cut5")

_SENT_END_RE = re.compile(r"[。！？；…]+|[!?;]+(?=\s|$)|\.(?=\s|$)")


def sentence_count(text):
    """句数：按句末标点计数，没有句末标点算 1 句。"""
    t = (text or "").strip()
    if not t:
        return 1
    return max(1, len(_SENT_END_RE.findall(t)))


def pick_split_method(text, forced=""):
    """按文本自动选 text_split_method；forced 非空时直接用它（--split-method）。"""
    if forced:
        return forced
    t = (text or "").strip()
    if len(t) > SPLIT_AUTO_MAX_CHARS:
        return "cut5"
    if sentence_count(t) <= 1:
        return "cut0"
    return "cut1"


def log(msg):
    sys.stderr.write("[gateway] %s\n" % msg)
    sys.stderr.flush()


def load_voices(path, default_ref, default_prompt, default_prompt_lang):
    """voices.json -> {name: {ref_audio, prompt_text, prompt_lang}}"""
    voices = {}
    if path:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            raise SystemExit("voices.json 必须是 {名称: {ref_audio, prompt_text}} 形式的对象")
        for name, spec in raw.items():
            spec = spec or {}
            voices[str(name)] = {
                "ref_audio": str(spec.get("ref_audio") or spec.get("refAudio") or ""),
                "prompt_text": str(spec.get("prompt_text") or spec.get("promptText") or ""),
                "prompt_lang": str(spec.get("prompt_lang") or spec.get("promptLang") or default_prompt_lang),
            }
    if default_ref:
        voices.setdefault("default", {
            "ref_audio": default_ref,
            "prompt_text": default_prompt,
            "prompt_lang": default_prompt_lang,
        })
    if not voices:
        raise SystemExit("至少要给一个参考音频：--ref-audio 或 --voices voices.json")
    for name, spec in voices.items():
        if not spec["ref_audio"]:
            raise SystemExit("音色 %r 缺少 ref_audio" % name)
        if not os.path.exists(spec["ref_audio"]):
            log("警告：音色 %r 的参考音频不存在：%s" % (name, spec["ref_audio"]))
        if not spec["prompt_text"]:
            log("警告：音色 %r 的 prompt_text 为空 —— GPT-SoVITS 会 400 或读错文本" % name)
    return voices


def resolve_voice(voices, voice, args):
    """voice 字段 -> (ref_audio, prompt_text, prompt_lang)"""
    v = str(voice or "").strip()
    if v in voices:
        spec = voices[v]
        return spec["ref_audio"], spec["prompt_text"], spec["prompt_lang"]
    if v and os.path.exists(v):
        return v, args.prompt_text, args.prompt_lang
    # 兜底：显式 default > 叫「默认」的条目 > voices.json 里的第一个（保持文件顺序）
    if "default" in voices:
        first = voices["default"]
    elif "默认" in voices:
        first = voices["默认"]
    else:
        first = voices[next(iter(voices))]
    return first["ref_audio"], first["prompt_text"], first["prompt_lang"]


def build_payload(body, voices, args):
    text = str(body.get("input") or "").strip()
    if not text:
        raise ValueError("input 为空")

    ref_audio, prompt_text, prompt_lang = resolve_voice(voices, body.get("voice"), args)

    payload = dict(SAMPLING)
    payload.update({
        "text": text,
        "text_lang": str(body.get("text_lang") or args.text_lang),
        "ref_audio_path": ref_audio,
        "prompt_text": prompt_text,
        "prompt_lang": prompt_lang,
        "media_type": str(body.get("response_format") or "wav").lower(),
        "streaming_mode": False,
        # 单句整段合成，避免二次切分把句尾气口切掉（见上方「切分策略」）
        "text_split_method": pick_split_method(text, args.split_method),
    })
    # OpenAI 的 speed 倍率 -> GPT-SoVITS 的 speed_factor
    speed = body.get("speed")
    if speed is not None:
        try:
            payload["speed_factor"] = max(0.25, min(4.0, float(speed)))
        except (TypeError, ValueError):
            pass
    # extraBody 透传：除协议字段和网关自己消费的键，其余原样并入上游 payload
    for k, val in body.items():
        if k in OPENAI_KEYS or k in GATEWAY_KEYS:
            continue
        payload[k] = val
    return payload


def is_loopback(host):
    h = (host or "").lower().strip("[]")
    return h in ("localhost", "::1") or h.startswith("127.")


_OPENERS = {}


def opener_for(url):
    """本机地址绝不走系统代理。

    Windows 上开了 Clash/V2Ray 之类会全局设置 HTTP_PROXY，urllib 默认照单全收：
    连 127.0.0.1:9881 也先发给代理，代理再回头连本机。结果是
      - 每次合成多一跳，白加几十到几百毫秒；
      - api_v2.py 没起来时收到的是代理的 502 HTML/JSON，而不是连接被拒，
        用户看到「upstream connect failed (os error 10061)」完全猜不到该去启什么。
    """
    host = urllib.parse.urlsplit(url).hostname or ""
    key = bool(is_loopback(host))
    if key not in _OPENERS:
        handlers = [urllib.request.ProxyHandler({})] if key else []
        _OPENERS[key] = urllib.request.build_opener(*handlers)
    return _OPENERS[key]


def forward(upstream, payload, timeout):
    url = upstream.rstrip("/") + "/tts"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener_for(url).open(req, timeout=timeout) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()
    except urllib.error.URLError as e:
        raise ConnectionError("无法连接 %s：%s（api_v2.py 起来了吗？）" % (url, e.reason))


def sniff_container(buf):
    if len(buf) >= 12 and buf[:4] == b"RIFF" and buf[8:12] == b"WAVE":
        return "wav", "audio/wav"
    if len(buf) >= 2 and buf[0] == 0xFF and (buf[1] & 0xE0) == 0xE0:
        # 0xFFF sync 同时被 MPEG 音频和 ADTS AAC 使用；只有 AAC 的 layer 位是 00
        return ("aac", "audio/aac") if ((buf[1] >> 1) & 0x03) == 0 else ("mp3", "audio/mpeg")
    if buf[:3] == b"ID3":
        return "mp3", "audio/mpeg"
    if buf[:4] == b"OggS":
        return "ogg", "audio/ogg"
    if buf[:4] == b"fLaC":
        return "flac", "audio/flac"
    return "", "application/octet-stream"


class Handler(BaseHTTPRequestHandler):
    server_version = "gpt-sovits-openai-gateway/1.0"
    protocol_version = "HTTP/1.1"

    # --- 日志：只记方法/路径/状态，不打文本内容 ---
    def log_message(self, fmt, *a):
        log("%s %s" % (self.command, self.path))

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, code, message, etype="invalid_request_error"):
        self._send_json(code, {"error": {"message": message, "type": etype}})

    def do_GET(self):
        if self.path.split("?")[0] in ("/v1/models", "/models"):
            self._send_json(200, {
                "object": "list",
                "data": [{"id": self.server.model_id, "object": "model", "owned_by": "gpt-sovits"}],
            })
            return
        if self.path.split("?")[0] in ("/health", "/v1/health"):
            self._send_json(200, {"ok": True, "voices": sorted(self.server.voices.keys())})
            return
        self._send_error_json(404, "not found: " + self.path)

    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/v1/audio/speech", "/audio/speech"):
            self._send_error_json(404, "not found: " + path)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8"))
            except ValueError as e:
                self._send_error_json(400, "请求体不是合法 JSON：%s" % e)
                return
            if not isinstance(body, dict):
                self._send_error_json(400, "请求体必须是 JSON 对象")
                return

            payload = build_payload(body, self.server.voices, self.server.args)
            status, ctype, data = forward(self.server.args.upstream, payload, self.server.args.timeout)

            if status != 200:
                detail = data.decode("utf-8", "replace")[:400]
                log("上游 HTTP %s：%s" % (status, detail.replace("\n", " ")))
                self._send_error_json(
                    502 if status >= 500 else 400,
                    "GPT-SoVITS /tts 返回 HTTP %s：%s" % (status, detail),
                    "upstream_error",
                )
                return

            kind, mime = sniff_container(data)
            if not kind:
                # 上游 200 但不是音频：典型是 FastAPI 把校验错误包成 JSON 返回了
                detail = data.decode("utf-8", "replace")[:400]
                log("上游返回的不是音频：%s" % detail.replace("\n", " "))
                self._send_error_json(502, "GPT-SoVITS 返回的不是音频：%s" % detail, "upstream_error")
                return
            if len(data) < 1000:
                self._send_error_json(502, "GPT-SoVITS 返回的音频过小（%d 字节）" % len(data), "upstream_error")
                return

            log("ok %s %d bytes · ref=%s" % (kind, len(data), os.path.basename(payload["ref_audio_path"])))
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (ValueError, ConnectionError) as e:
            log("错误：%s" % e)
            if isinstance(e, ValueError):
                self._send_error_json(400, str(e))
            else:
                self._send_error_json(502, str(e), "upstream_unreachable")
        except Exception as e:  # noqa: BLE001 — 网关不该因单次请求崩掉
            log("未预期错误：%r" % e)
            try:
                self._send_error_json(500, "gateway error: %s" % e)
            except Exception:
                pass


class GatewayServer(ThreadingHTTPServer):
    """浏览器/客户端关掉 keep-alive 连接时，socketserver 会打一整段 traceback。

    这类 ConnectionAborted/Reset 不是错误（插件播放中断、页面刷新都会触发），
    打印出来只会让用户以为网关崩了，所以在这里静音；真正的异常照常上抛。
    """

    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main():
    ap = argparse.ArgumentParser(description="GPT-SoVITS -> OpenAI /v1/audio/speech 网关")
    ap.add_argument("--upstream", default="http://127.0.0.1:9881", help="api_v2.py 地址（默认 9881）")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址（默认只监听本机）")
    ap.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    ap.add_argument("--ref-audio", default="", help="默认参考音频路径")
    ap.add_argument("--prompt-text", default="", help="默认参考音频的逐字文本（必须严格对应）")
    ap.add_argument("--prompt-lang", default="zh", help="参考音频语种（默认 zh）")
    ap.add_argument("--text-lang", default="zh", help="朗读文本语种（默认 zh）")
    ap.add_argument("--split-method", default="",
                    help="强制 text_split_method（cut0~cut5）。留空 = 自动：≤1 句 cut0 / 多句 cut1 / >%d 字 cut5"
                         % SPLIT_AUTO_MAX_CHARS)
    ap.add_argument("--voices", default="", help="多音色映射 JSON（插件 voice 填名称即可切换）")
    ap.add_argument("--model-id", default="gpt-sovits", help="/v1/models 返回的模型名")
    ap.add_argument("--timeout", type=float, default=600.0, help="上游超时秒数（冷启动首句可能 10s+）")
    args = ap.parse_args()

    if args.split_method and args.split_method not in CUT_METHODS:
        raise SystemExit("--split-method 只能是 %s，收到 %r" % ("/".join(CUT_METHODS), args.split_method))

    voices = load_voices(args.voices, args.ref_audio, args.prompt_text, args.prompt_lang)

    srv = GatewayServer((args.host, args.port), Handler)
    srv.voices = voices
    srv.args = args
    srv.model_id = args.model_id

    log("监听 http://%s:%d/v1/audio/speech" % (args.host, args.port))
    log("上游 %s/tts" % args.upstream.rstrip("/"))
    log("音色：%s" % "、".join("%s(%s)" % (n, os.path.basename(s["ref_audio"] or "?")) for n, s in voices.items()))
    log("在插件里：提供者选「OpenAI 兼容」，API 地址 http://%s:%d，模型 %s，音色填上面的名字" % (args.host, args.port, args.model_id))
    if args.split_method:
        log("切分：强制 %s（--split-method）" % args.split_method)
    else:
        log("切分：自动（≤1 句 cut0 / 多句 cut1 / >%d 字 cut5）" % SPLIT_AUTO_MAX_CHARS)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("已停止")


if __name__ == "__main__":
    main()
