// @dsh-external/dsh-plugin-tts — Client half (browser bundle).
// Hand-written in the harness module-loader format; `require` answers the
// platform externals (react), everything else is inlined.
window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-plugin-tts",
  factory: require => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    const apply = ctx => {
      const slots = ctx.get("slots");
      if (!slots) return;

      // ------------------------------------------------------------------
      // i18n — full zh/en coverage for the whole plugin UI. The plugin is a
      // legacy hand-written bundle, so i18n is a minimal t() over two inline
      // dictionaries (zh / en) with a language setting: "auto" follows the
      // browser/host locale, "zh" and "en" force a language. `t(key, params)`
      // resolves key -> string, substitutes {name} placeholders, and falls
      // back to en then to the key itself so the UI never blanks.
      // ------------------------------------------------------------------
      const UI_LOCALES = { zh: "zh", en: "en" }; // canonical values
      function resolveLocale(pref) {
        if (pref === "zh" || pref === "en") return pref;
        let code = "";
        try { code = (navigator && navigator.language) || ""; } catch (e) {}
        if (/^zh/i.test(code)) return "zh";
        return "en";
      }
      // Language preference is persisted in localStorage (same pattern as the
      // voice-pack settings below) so the chosen UI language survives reloads.
      const LANG_KEY = "dsh-tts-lang";
      function loadPersistedLang() {
        try {
          const v = localStorage.getItem(LANG_KEY);
          if (v === "zh" || v === "en" || v === "auto") return v;
        } catch (e) { /* non-fatal */ }
        return "auto";
      }
      const I18N = {
        lang: loadPersistedLang(), // "auto" | "zh" | "en" (persisted via localStorage)
        dict: {
          zh: {
            "autoRead.on": "自动朗读已开启",
            "autoRead.off": "自动朗读已关闭",
            "autoRead.label": "自动朗读",
            "autoRead.on.title": "自动朗读：开启（点击关闭）",
            "autoRead.off.title": "自动朗读：关闭（点击开启）",
            "stopRead.part.lead": "停止朗读（第 ",
            "stopRead.part.tail": " 段播放中）",
            "stopRead": "停止朗读",
            "readThisMessage": "朗读本条消息",
            "mini.pause": "暂停",
            "mini.resume": "继续播放",
            "mini.speed": "播放速度",
            "mini.speedTip": "切换朗读速度（1x / 1.25x / 1.5x）",
            "download.audio": "下载音频",
            "download.notSupported": "长文本分段朗读暂不支持导出为单个音频文件",
            "download.fail": "下载失败：",
            "sel.read": "朗读选中文本",
            "voice.xiaoxuan": "晓萱（zh-CN-XiaoxuanNeural）",
            "voice.xiaoyi": "晓伊（zh-CN-XiaoyiNeural）",
            "voice.yunxi": "云希（zh-CN-YunxiNeural）",
            "voice.yunyang": "云扬（zh-CN-YunyangNeural）",
            "voice.xiaoxiao": "晓晓（zh-CN-XiaoxiaoNeural）",
            "voice.yunjian": "云健（zh-CN-YunjianNeural）",
            "voice.yunxia": "云夏（zh-CN-YunxiaNeural）",
            "voice.xiaobei": "晓北·辽宁（zh-CN-liaoning-XiaobeiNeural）",
            "voice.xiaoni": "晓妮·陕西（zh-CN-shaanxi-XiaoniNeural）",
            "voice.hsiaochen": "曉臻（zh-TW-HsiaoChenNeural）",
            "voice.hsiaoyu": "曉雨（zh-TW-HsiaoYuNeural）",
            "voice.yunjhe": "雲哲（zh-TW-YunJheNeural）",
            "voice.hiugaai": "曉佳（zh-HK-HiuGaaiNeural）",
            "voice.hiumaan": "曉曼（zh-HK-HiuMaanNeural）",
            "voice.wanlung": "雲龍（zh-HK-WanLungNeural）",
            "voice.nanami": "七海（ja-JP-NanamiNeural）",
            "voice.svetlana": "斯韦特兰娜（ru-RU-SvetlanaNeural）",
            "voice.dmitry": "德米特里（ru-RU-DmitryNeural）",
            "preview.defaultText": "你好，这是一个语音测试。",
            "preview.emptyError": "请输入要试听的内容",
            "synthFail": "语音合成失败：",
            "fileListFail": "读取文件列表失败：",
            "tab.index": "索引",
            "tab.model": "模型",
            "busy.preparing": "准备中…",
            "packs.needUrl": "请先填写音色包仓库地址",
            "packs.listFail": "获取列表失败：",
            "packs.waitingStart": "等待开始",
            "packs.done": "完成",
            "packs.installedEnabled": "已安装并启用「",
            "packs.alreadyLatest": "（已是最新版本）",
            "packs.installFail": "安装失败：",
            "packs.unknownError": "未知错误",
            "packs.confirmUninstall.lead": "确定卸载音色包「",
            "packs.confirmUninstall.tail": "」？将删除已下载的模型与索引文件。",
            "packs.uninstalled": "已卸载「",
            "packs.uninstallFail": "卸载失败：",
            "diag.httpUnavailable": "诊断接口不可用（HTTP ",
            "diag.httpUnavailable.tail": "）：插件 Host 已更新但 dsh web 未重启，请重启 dsh web 后重试",
            "diag.httpFail": "诊断失败（HTTP ",
            "diag.httpFail.tail": "），请稍后重试",
            "diag.title": "诊断",
            "diag.desc": "一键检查：Edge TTS 在线合成是否正常、本地 RVC 服务是否已启动、模型是否已加载",
            "diag.running": "检查中…（约 1-2 秒）",
            "diag.run": "运行诊断",
            "diag.fail": "诊断失败：",
            "packs.title": "音色包",
            "packs.desc": "从网上（或朋友的分享）一键下载现成音色，下载好自动启用，不用自己找文件",
            "packs.installTo": "下载后安装到：",
            "packs.installTo.tail": "（模型与索引会自动填入上方 RVC 配置）",
            "packs.registryUrl": "仓库地址",
            "packs.loading": "加载中…",
            "packs.fetchList": "获取列表",
            "packs.registryHelp": "音色作者会给你一个网址（仓库地址），填进去点「获取列表」就能看到有哪些音色。下载和文件校验由插件自动完成",
            "packs.proxy": "代理地址（可选）",
            "packs.proxyPlaceholder": "http://127.0.0.1:7897（Clash 等本地代理）",
            "packs.proxyHelp": "直连 GitHub raw 很慢时（实测 ~100KB/s），填本地代理（如 Clash 的 http://127.0.0.1:7897）可提速到十几 MB/s；留空 = 直连",
            "packs.fetching": "正在获取清单…",
            "packs.installedV": "已安装 v",
            "packs.uninstall": "卸载",
            "packs.downloading": "下载中…",
            "packs.downloadEnable": "下载并启用",
            "packs.indexVersion": "索引版本：",
            "packs.modelSep": " ｜ 模型 ",
            "packs.plusIdx": " + 可选索引 ",
            "packs.count": " 个（",
            "packs.plusIndex": " + 索引 ",
            "packs.noIndex": "（免索引）",
            "packs.licenseSep": " ｜ 许可 ",
            "packs.unknown": "未知",
            "packs.authorSep": " ｜ 作者 ",
            "packs.copyright": "只能安装版权允许分发的音色（注意看每个包的「许可」）。演示音色 azusa-test 受版权限制，不会出现在公开仓库里。",
            "compact.size2k": "2k（约 6 MB）",
            "compact.size5k": "5k（约 15 MB）",
            "compact.size10k": "10k（约 30 MB）",
            "compact.size20k": "20k（约 60 MB）",
            "compact.needIndex": "请先填写或选择要压缩的索引路径",
            "compact.fail": "生成失败：",
            "compact.noIndex": "（未填写索引路径）",
            "compact.desc": "生成紧凑索引 —— 把大索引变小：从原索引中抽样重建，音色还原度基本不变。索引越小，加载越快、越容易分享",
            "compact.source": "来源：",
            "compact.building": "构建中…",
            "compact.generate": "生成",
            "compact.close": "关闭",
            "compact.reading": "正在读取大索引并抽样重建…（约几秒到几十秒，内存峰值 ~1GB）",
            "compact.alreadySmall.lead": "原索引已足够小（",
            "compact.alreadySmall.tail": "），无需压缩。",
            "compact.generated": "已生成：",
            "compact.orig": "，原 ",
            "compact.autoFill": "%），已自动填入索引路径。",
            "picker.readingFiles": "正在读取文件列表…",
            "picker.found": "发现 ",
            "picker.foundTail": " 个文件（点击选择）",
            "picker.none": "未发现文件（可手动输入路径）",
            "f0.default": "默认",
            "f0.semitones": " 半音",
            "baseVoice.yunyang": "云扬（男声）",
            "baseVoice.yunxi": "云希（男声）",
            "baseVoice.yunxia": "云夏（男声）",
            "baseVoice.xiaoxiao": "晓晓（女声）",
            "baseVoice.xiaoyi": "晓伊（女声）",
            "baseVoice.guy": "Guy（en 男声）",
            "baseVoice.jenny": "Jenny（en 女声）",
            "f0.rmvpe": "rmvpe（效果最好）",
            "f0.pm": "pm（最快）",
            "f0.harvest": "harvest（低音好但慢）",
            "f0.crepe": "crepe（吃 GPU）",
            "section.voiceTuning": "声音调节",
            "voiceTuning.desc": "调整朗读的语气和速度（转换前生效，最终音色会保留这些语调）",
            "voiceTuning.edgeDesc": "直接作用于 Edge TTS 朗读（0 = 默认）",
            "field.rate": "语速",
            "field.rate.tip": "朗读快慢：向左慢、向右快，0 为默认",
            "field.pitch": "音调",
            "field.pitch.tip": "声音高低：负值更低沉，正值更明亮",
            "field.volume": "音量",
            "field.volume.tip": "朗读响度：负值更轻，正值更响",
            "section.rvc": "RVC 配置",
            "rvc.desc": "用你自己训练好的音色模型来朗读。首次使用先启动本地 RVC 服务（macOS/Windows/Linux 命令见使用手册 §4.2 / RVC 指南）；服务没启动时点「浏览」会看到具体启动步骤。启动后再在这里填模型路径",
            "onboard.title": "首次使用 RVC？三步上手",
            "onboard.desc": "用自定义音色朗读需要：① 模型文件 (.pth)；② 本机正在运行的转换服务。",
            "onboard.steps": "① 先启动本地 RVC 服务（保持终端/窗口运行）；\n② 在下方「模型路径」选择或粘贴 .pth 文件；\n③ 索引可选；点「一键诊断」确认服务在线、模型已加载。",
            "onboard.cmd": "# Windows（PowerShell/CMD，<你的RVC目录> 换成实际路径）\n<你的RVC目录>/runtime/python.exe rvc-server.py --port 4892\n\n# macOS / Linux\n<你的RVC目录>/runtime/bin/python rvc-server.py --port 4892\n# 便携运行时：解压后运行 ./start-rvc-server.sh",
            "field.baseUrl": "服务地址",
            "field.baseUrl.tip": "一般保持默认即可：这是你电脑上那个转换服务的地址（默认 4892 端口）",
            "field.baseSource": "原声来源",
            "baseSource.edge": "让 Edge TTS 先读一遍",
            "baseSource.upload": "上传自己的音频",
            "baseSource.tip": "转换前的原声从哪里来：让 Edge TTS 自动读一遍（推荐，最方便），或上传你自己的一段录音/音频",
            "baseSource.uploadBtn": "上传音频",
            "baseSource.chooseFile": "选择文件",
            "baseSource.noFile": "未选择文件",
            "baseSource.uploadTip": "上传后直接用这段音频做转换，不再经过 Edge TTS；上面的语速/音调/音量设置不适用",
            "field.baseVoice": "原声音色",
            "field.baseVoice.tip": "转换前由 Edge TTS 用哪个声音读（决定语气和停顿）；转换后说话人声音会变成你模型的音色",
            "field.modelPath": "模型路径 (.pth)",
            "field.browse": "浏览",
            "field.modelPath.tip": "你的音色模型文件（.pth），通常叫 xxx.pth。用「浏览」从电脑上选，或直接粘贴路径",
            "field.indexPath": "索引路径 (.index)",
            "indexPath.empty": "留空 = 免索引",
            "indexPath.compactTip": "生成紧凑索引：把几百 MB 的索引缩到几 MB（音色还原度基本不变）",
            "indexPath.compact": "压缩索引",
            "indexPath.tip": "可选。留空 = 免索引（效果略降但能用）；「浏览」选 .index 文件；「压缩索引」把大索引缩到几 MB",
            "section.advanced": "高级参数（一般不用改）",
            "field.spkId": "说话人 ID",
            "field.spkId.tip": "多说话人模型选择说话人；单说话人模型保持 0",
            "field.f0Method": "f0 方法",
            "field.f0Method.tip": "音高检测算法：rmvpe 效果最好，pm 最快，harvest 低音好但慢",
            "field.f0UpKey": "变调",
            "field.f0UpKey.tip": "整体升降调：负值更低沉、正值更尖锐（可当声线调节）",
            "field.indexRate": "索引权重",
            "field.indexRate.tip": "越高越像模型原来的声音，越低越像你输入的原始声音（0 = 完全不用索引）",
            "field.resampleSr": "输出采样率",
            "field.resampleSr.tip": "输出音频采样率：越高细节越好、文件越大",
            "field.rmsMixRate": "响度混合",
            "field.rmsMixRate.tip": "输出音量包络混合比例：越高越接近模型训练者的响度习惯",
            "field.protect": "辅音保护",
            "field.protect.tip": "保护清辅音与呼吸声；过高会保留更多原声细节",
            "field.filterRadius": "滤波半径",
            "field.filterRadius.tip": "音高平滑滤波（仅 harvest 有效）：越大曲线越平滑",
            "field.f0File": "F0 曲线文件",
            "f0File.empty": "留空 = 自动提取音高",
            "f0File.tip": "手动指定音高曲线文件；留空自动提取",
            "provider.label": "TTS提供者",
            "provider.help": "Edge TTS：免费在线音色，开箱即用；自定义音色（RVC）：用你自己训练的模型，需先启动转换服务",
            "provider.rvc": "自定义音色（RVC）",
            "field.voice": "朗读音色",
            "field.voice.tip": "选择朗读用的声音（仅 Edge TTS 模式可选）",
            "preview.title": "试听测试",
            "preview.text": "试听文本",
            "preview.stop": "停止试听",
            "preview.play": "试听",
            "preview.playing": "停止试听（播放中）",
            "chunk.playing.lead": "正在播放 第 ",
            "chunk.playing.tail": " 段 · 后续段落边播边合成…",
            "footnote": "由 Microsoft Edge TTS 驱动（node-edge-tts）。",
                        "err.chunkFail": "后续段落合成失败：",
            "err.audioDecode": "音频解码失败：",
            "err.chunkSkip": "某段音频加载失败，已跳过",
            "err.synthFailShort": "语音合成失败",
            "err.audioLoadRetry": "音频加载失败，请重试",
            "lang.label": "界面语言",
            "lang.auto": "自动（跟随浏览器）",
            "lang.zh": "中文",
            "lang.en": "English",
            "lang.modeAuto": "界面语言自动跟随浏览器",
            "lang.modeManual": "界面语言已手动指定",
            "host.rvcUnreachable": "无法连接本地 RVC 推理服务",
            "host.rvcHttpFail": "RVC 接口失败",
            "host.rvcConvertNoAudio": "RVC /convert 返回异常",
            "host.noModelConfigured": "未配置 RVC 模型路径（设置 → 插件 → 语音 → RVC 配置）",
            "host.registryNotUrl": "仓库地址必须是 http(s) URL",
            "host.manifestInvalid": "清单格式无效",
            "host.manifestNoPacks": "清单格式无效（缺少 packs 数组）",
            "host.downloadFailed": "下载失败",
            "host.downloadStreamUnavailable": "下载流不可用",
            "host.sizeMismatch": "文件大小不符",
            "host.sha256Mismatch": "sha256 校验失败",
            "host.packNotFound": "仓库中没有该音色包",
            "host.packNoModel": "音色包缺少模型文件",
            "host.filesHttpFail": "文件列表接口异常",
            "host.filesNeedsServer": "读取文件列表失败：无法连接本地 RVC 服务（{baseUrl}）。\n\n请先启动 RVC 服务：\n{startup}\n\n启动成功后保持终端/窗口不关，再回来点「浏览」。如果服务已启动，请确认「服务地址」与端口一致。\n原始错误：{error}",
            "host.chunkFail": "后续段落合成失败",
            "host.compactNeedsServer": "生成紧凑索引失败：无法连接本地 RVC 服务（{baseUrl}）。\n\n请先启动 RVC 服务：\n{startup}\n\n启动成功后保持终端/窗口不关，再重试。如果服务已启动，请确认「服务地址」与端口一致。\n原始错误：{error}",
            "host.compactFail": "紧凑索引生成失败",
            "host.packsListFail": "获取音色包列表失败",
            "host.registryPackRequired": "registry 与 packId 必填",
            "host.packInstallFail": "音色包安装失败",
            "host.packIdRequired": "packId 必填",
            "host.packUninstallFail": "卸载失败",
            "host.phase.prepare": "准备",
            "host.phase.model": "模型",
            "host.phase.index": "索引",
"tab.voice": "语音",
            "voice.removed": "所选音色已被端点移除，已自动切换回默认音色",
            "settings.reset": "恢复默认设置",
            "settings.resetDone": "已恢复默认设置",
            "voice.xiaobei": "晓北·辽宁（zh-CN-liaoning-XiaobeiNeural）",
            "voice.xiaoni": "晓妮·陕西（zh-CN-shaanxi-XiaoniNeural）",
            "voice.hsiaochen": "曉臻（zh-TW-HsiaoChenNeural）",
            "voice.hsiaoyu": "曉雨（zh-TW-HsiaoYuNeural）",
            "voice.yunjhe": "雲哲（zh-TW-YunJheNeural）",
            "voice.hiugaai": "曉佳（zh-HK-HiuGaaiNeural）",
            "voice.hiumaan": "曉曼（zh-HK-HiuMaanNeural）",
            "voice.wanlung": "雲龍（zh-HK-WanLungNeural）",
            "voice.nanami": "七海（ja-JP-NanamiNeural）",
            "err.chunkFail": "后续段落合成失败：",
            "err.audioDecode": "音频解码失败：",
            "err.chunkSkip": "某段音频加载失败，已跳过",
            "err.synthFailShort": "语音合成失败",
            "err.audioLoadRetry": "音频加载失败，请重试",
          },
          en: {
            "autoRead.on": "Auto-read on",
            "autoRead.off": "Auto-read off",
            "autoRead.label": "Auto-read",
            "autoRead.on.title": "Auto-read: ON (click to turn off)",
            "autoRead.off.title": "Auto-read: OFF (click to turn on)",
            "stopRead.part.lead": "Stop (section ",
            "stopRead.part.tail": " of {total} playing)",
            "stopRead": "Stop reading",
            "readThisMessage": "Read this message",
            "mini.pause": "Pause",
            "mini.resume": "Resume",
            "mini.speed": "Playback speed",
            "mini.speedTip": "Cycle reading speed (1x / 1.25x / 1.5x)",
            "download.audio": "Download audio",
            "download.notSupported": "Long chunked reads can't be exported as a single file yet",
            "download.fail": "Download failed: ",
            "sel.read": "Read selected text",
            "voice.xiaoxuan": "Xiaoxuan (zh-CN-XiaoxuanNeural)",
            "voice.xiaoyi": "Xiaoyi (zh-CN-XiaoyiNeural)",
            "voice.yunxi": "Yunxi (zh-CN-YunxiNeural)",
            "voice.yunyang": "Yunyang (zh-CN-YunyangNeural)",
            "voice.xiaoxiao": "Xiaoxiao (zh-CN-XiaoxiaoNeural)",
            "voice.yunjian": "Yunjian (zh-CN-YunjianNeural)",
            "voice.yunxia": "Yunxia (zh-CN-YunxiaNeural)",
            "voice.xiaobei": "Xiaobei-Liaoning (zh-CN-liaoning-XiaobeiNeural)",
            "voice.xiaoni": "Xiaoni-Shaanxi (zh-CN-shaanxi-XiaoniNeural)",
            "voice.hsiaochen": "HsiaoChen (zh-TW-HsiaoChenNeural)",
            "voice.hsiaoyu": "HsiaoYu (zh-TW-HsiaoYuNeural)",
            "voice.yunjhe": "YunJhe (zh-TW-YunJheNeural)",
            "voice.hiugaai": "HiuGaai (zh-HK-HiuGaaiNeural)",
            "voice.hiumaan": "HiuMaan (zh-HK-HiuMaanNeural)",
            "voice.wanlung": "WanLung (zh-HK-WanLungNeural)",
            "voice.nanami": "Nanami (ja-JP-NanamiNeural)",
            "voice.svetlana": "Svetlana (ru-RU-SvetlanaNeural)",
            "voice.dmitry": "Dmitry (ru-RU-DmitryNeural)",
            "preview.defaultText": "Hi, this is a voice test.",
            "preview.emptyError": "Enter some text to preview first",
            "synthFail": "Speech synthesis failed: ",
            "fileListFail": "Failed to load file list: ",
            "tab.index": "Index",
            "tab.model": "Model",
            "busy.preparing": "Preparing…",
            "packs.needUrl": "Enter a voice-pack registry URL first",
            "packs.listFail": "Failed to fetch list: ",
            "packs.waitingStart": "Waiting to start",
            "packs.done": "Done",
            "packs.installedEnabled": "Installed & enabled “",
            "packs.alreadyLatest": " (already latest)",
            "packs.installFail": "Install failed: ",
            "packs.unknownError": "Unknown error",
            "packs.confirmUninstall.lead": "Uninstall voice pack “",
            "packs.confirmUninstall.tail": "”? The downloaded model & index files will be deleted.",
            "packs.uninstalled": "Uninstalled “",
            "packs.uninstallFail": "Uninstall failed: ",
            "diag.httpUnavailable": "Diagnostics endpoint unavailable (HTTP ",
            "diag.httpUnavailable.tail": "): the plugin Host was updated but dsh web wasn't restarted — restart dsh web and retry",
            "diag.httpFail": "Diagnostics failed (HTTP ",
            "diag.httpFail.tail": "), please retry later",
            "diag.title": "Diagnostics",
            "diag.desc": "One-click check: Edge TTS synthesis, whether the local RVC service is up, and whether the model is loaded",
            "diag.running": "Checking… (about 1-2s)",
            "diag.run": "Run diagnostics",
            "diag.fail": "Diagnostics failed: ",
            "packs.title": "Voice packs",
            "packs.desc": "One-click download of ready-made voices from the web (or a friend's share); auto-enabled after download — no need to find files yourself",
            "packs.installTo": "Installs to:",
            "packs.installTo.tail": " (model & index are auto-filled into the RVC config above)",
            "packs.registryUrl": "Registry URL",
            "packs.loading": "Loading…",
            "packs.fetchList": "Fetch list",
            "packs.registryHelp": "The pack author gives you a URL (registry). Paste it and click “Fetch list” to see available voices. Download & file verification are handled automatically",
            "packs.proxy": "Proxy URL (optional)",
            "packs.proxyPlaceholder": "http://127.0.0.1:7897 (local proxy such as Clash)",
            "packs.proxyHelp": "When direct GitHub raw is slow (~100KB/s measured), a local proxy (e.g. Clash http://127.0.0.1:7897) can speed it to tens of MB/s; leave blank for direct",
            "packs.fetching": "Fetching manifest…",
            "packs.installedV": "Installed v",
            "packs.uninstall": "Uninstall",
            "packs.downloading": "Downloading…",
            "packs.downloadEnable": "Download & enable",
            "packs.indexVersion": "Index version: ",
            "packs.modelSep": "  model ",
            "packs.plusIdx": " + optional index ",
            "packs.count": " (",
            "packs.plusIndex": " + index ",
            "packs.noIndex": " (index-free)",
            "packs.licenseSep": "  license ",
            "packs.unknown": "Unknown",
            "packs.authorSep": "  author ",
            "packs.copyright": "Only install packs whose license permits redistribution (check each pack's “license”). The demo voice azusa-test is copyright-restricted and won't appear in public registries.",
            "compact.size2k": "2k (~6 MB)",
            "compact.size5k": "5k (~15 MB)",
            "compact.size10k": "10k (~30 MB)",
            "compact.size20k": "20k (~60 MB)",
            "compact.needIndex": "Enter or pick the index path to compact first",
            "compact.fail": "Generation failed: ",
            "compact.noIndex": " (no index path)",
            "compact.desc": "Build a compact index — shrink big indexes by sampling & rebuilding; timbre fidelity is basically unchanged. Smaller = faster load & easier to share",
            "compact.source": "Source: ",
            "compact.building": "Building…",
            "compact.generate": "Generate",
            "compact.close": "Close",
            "compact.reading": "Reading the big index and sampling… (a few sec to tens of sec, ~1GB peak memory)",
            "compact.alreadySmall.lead": "Source index is already small (",
            "compact.alreadySmall.tail": "), no compaction needed.",
            "compact.generated": "Generated: ",
            "compact.orig": ", source ",
            "compact.autoFill": "%), auto-filled into the index path.",
            "picker.readingFiles": "Reading file list…",
            "picker.found": "Found ",
            "picker.foundTail": " files (click to select)",
            "picker.none": "No files found (you can type the path manually)",
            "f0.default": "Default",
            "f0.semitones": " semitones",
            "baseVoice.yunyang": "Yunyang (male)",
            "baseVoice.yunxi": "Yunxi (male)",
            "baseVoice.yunxia": "Yunxia (male)",
            "baseVoice.xiaoxiao": "Xiaoxiao (female)",
            "baseVoice.xiaoyi": "Xiaoyi (female)",
            "baseVoice.guy": "Guy (EN male)",
            "baseVoice.jenny": "Jenny (EN female)",
            "f0.rmvpe": "rmvpe (best quality)",
            "f0.pm": "pm (fastest)",
            "f0.harvest": "harvest (good bass but slow)",
            "f0.crepe": "crepe (GPU heavy)",
            "section.voiceTuning": "Voice tuning",
            "voiceTuning.desc": "Adjust tone & speed of the read (applied before conversion; final voice keeps these intonations)",
            "voiceTuning.edgeDesc": "Applies directly to Edge TTS (0 = default)",
            "field.rate": "Rate",
            "field.rate.tip": "Reading speed: left slower, right faster, 0 = default",
            "field.pitch": "Pitch",
            "field.pitch.tip": "Pitch: negative lower, positive brighter",
            "field.volume": "Volume",
            "field.volume.tip": "Loudness: negative softer, positive louder",
            "section.rvc": "RVC Config",
            "rvc.desc": "Read with your own trained voice model. Start the local RVC service first (macOS/Windows/Linux commands: User Guide §4.2 / RVC Guide); if it is not running, clicking Browse shows the startup steps. Then fill in the model path here",
            "onboard.title": "New to RVC? Three steps",
            "onboard.desc": "Reading with a custom voice needs: ① a model file (.pth); ② a running local conversion service.",
            "onboard.steps": "① Start the local RVC service first (keep the terminal/window running);\n② Pick or paste the .pth in \"Model path\" below;\n③ Index is optional; click \"Run diagnostics\" to confirm the service is online and the model is loaded.",
            "onboard.cmd": "# Windows (PowerShell/CMD, replace <yourRvcDir>)\n<yourRvcDir>/runtime/python.exe rvc-server.py --port 4892\n\n# macOS / Linux\n<yourRvcDir>/runtime/bin/python rvc-server.py --port 4892\n# portable runtime: run ./start-rvc-server.sh after extracting",
            "field.baseUrl": "Service URL",
            "field.baseUrl.tip": "Usually keep default: the address of the conversion service on this PC (default port 4892)",
            "field.baseSource": "Base audio source",
            "baseSource.edge": "Let Edge TTS read it first",
            "baseSource.upload": "Upload your own audio",
            "baseSource.tip": "Where the pre-conversion base audio comes from: let Edge TTS read it (recommended, easiest), or upload your own recording/audio",
            "baseSource.uploadBtn": "Upload audio",
            "baseSource.chooseFile": "Choose file",
            "baseSource.noFile": "No file selected",
            "baseSource.uploadTip": "After upload this audio is used directly, bypassing Edge TTS; the rate/pitch/volume settings above don't apply",
            "field.baseVoice": "Base voice",
            "field.baseVoice.tip": "Which Edge TTS voice reads before conversion (sets tone & pauses); after conversion the speaker becomes your model's voice",
            "field.modelPath": "Model path (.pth)",
            "field.browse": "Browse",
            "field.modelPath.tip": "Your voice model file (.pth), usually xxx.pth. Use “Browse” to pick, or paste the path",
            "field.indexPath": "Index path (.index)",
            "indexPath.empty": "Leave blank = index-free",
            "indexPath.compactTip": "Build a compact index: shrink a few-hundred-MB index to a few MB (fidelity basically unchanged)",
            "indexPath.compact": "Compact index",
            "indexPath.tip": "Optional. Leave blank = index-free (slightly lower fidelity but works); “Browse” for a .index file; “Compact index” shrinks a big index to a few MB",
            "section.advanced": "Advanced (usually no need to change)",
            "field.spkId": "Speaker ID",
            "field.spkId.tip": "Choose speaker for multi-speaker models; keep 0 for single-speaker",
            "field.f0Method": "F0 method",
            "field.f0Method.tip": "Pitch-detection algorithm: rmvpe best, pm fastest, harvest good bass but slow",
            "field.f0UpKey": "Pitch shift",
            "field.f0UpKey.tip": "Shift pitch: negative deeper, positive brighter (can be used as voice tuning)",
            "field.indexRate": "Index rate",
            "field.indexRate.tip": "Higher = closer to the model's original voice, lower = closer to your input (0 = no index)",
            "field.resampleSr": "Output sample rate",
            "field.resampleSr.tip": "Output sample rate: higher = more detail, bigger file",
            "field.rmsMixRate": "RMS mix",
            "field.rmsMixRate.tip": "Output loudness-envelope mix; higher = closer to the model owner's loudness",
            "field.protect": "Consonant protect",
            "field.protect.tip": "Protects consonants & breaths; too high keeps more original detail",
            "field.filterRadius": "Filter radius",
            "field.filterRadius.tip": "Pitch smoothing (harvest only): larger = smoother curve",
            "field.f0File": "F0 curve file",
            "f0File.empty": "Leave blank = auto-extract pitch",
            "f0File.tip": "Specify a pitch-curve file manually; leave blank for auto",
            "provider.label": "TTS provider",
            "provider.help": "Edge TTS: free online voices, works out of the box; Custom voice (RVC): use your own trained model, requires starting the conversion service",
            "provider.rvc": "Custom voice (RVC)",
            "field.voice": "Reading voice",
            "field.voice.tip": "Choose the speaking voice (Edge TTS mode only)",
            "preview.title": "Preview test",
            "preview.text": "Preview text",
            "preview.stop": "Stop preview",
            "preview.play": "Preview",
            "preview.playing": "Stop preview (playing)",
            "chunk.playing.lead": "Playing section ",
            "chunk.playing.tail": " · later sections synthesizing while playing…",
            "footnote": "Powered by Microsoft Edge TTS (node-edge-tts).",
                        "err.chunkFail": "Later-section synthesis failed: ",
            "err.audioDecode": "Audio decoding failed: ",
            "err.chunkSkip": "A section failed to load, skipped",
            "err.synthFailShort": "Speech synthesis failed",
            "err.audioLoadRetry": "Audio failed to load, please retry",
            "lang.label": "Language",
            "lang.auto": "Auto (follow browser)",
            "lang.zh": "中文",
            "lang.en": "English",
            "lang.modeAuto": "UI language follows the browser automatically",
            "lang.modeManual": "UI language is set manually",
            "host.rvcUnreachable": "Cannot connect to the local RVC service",
            "host.rvcHttpFail": "RVC endpoint failed",
            "host.rvcConvertNoAudio": "RVC /convert returned an unexpected response",
            "host.noModelConfigured": "No RVC model path configured (Settings → Plugins → Voice → RVC Config)",
            "host.registryNotUrl": "Registry address must be an http(s) URL",
            "host.manifestInvalid": "Invalid manifest format",
            "host.manifestNoPacks": "Invalid manifest (missing packs array)",
            "host.downloadFailed": "Download failed",
            "host.downloadStreamUnavailable": "Download stream unavailable",
            "host.sizeMismatch": "File size mismatch",
            "host.sha256Mismatch": "sha256 verification failed",
            "host.packNotFound": "Voice pack not found in registry",
            "host.packNoModel": "Voice pack is missing the model file",
            "host.filesHttpFail": "File-list endpoint error",
            "host.filesNeedsServer": "Failed to read file list: cannot reach the local RVC service ({baseUrl}).\n\nStart the RVC service first:\n{startup}\n\nKeep the terminal/window open, then click Browse again. If it is already running, check the Service URL matches the port.\nRaw error: {error}",
            "host.chunkFail": "Later-section synthesis failed",
            "host.compactNeedsServer": "Failed to compact the index: cannot reach the local RVC service ({baseUrl}).\n\nStart the RVC service first:\n{startup}\n\nKeep the terminal/window open, then retry. If it is already running, check the Service URL matches the port.\nRaw error: {error}",
            "host.compactFail": "Compact index generation failed",
            "host.packsListFail": "Failed to fetch the voice-pack list",
            "host.registryPackRequired": "registry and packId are required",
            "host.packInstallFail": "Voice pack install failed",
            "host.packIdRequired": "packId is required",
            "host.packUninstallFail": "Uninstall failed",
            "host.phase.prepare": "Preparing",
            "host.phase.model": "Model",
            "host.phase.index": "Index",
"tab.voice": "Voice",
            "voice.removed": "The selected voice was removed by the endpoint; auto-fell back to default",
            "settings.reset": "Reset to defaults",
            "settings.resetDone": "Settings reset to defaults",
          },        },
        listeners: new Set(),
        subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
        notify() { for (const fn of this.listeners) { try { fn(); } catch (e) {} } },
        setLang(v) {
          const next = v === "zh" || v === "en" ? v : "auto";
          if (this.lang === next) return;
          this.lang = next;
          try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* non-fatal */ }
          this.notify();
        },
        current() { return resolveLocale(this.lang); },
      };
      // test/debug hook: allows e.g. tests to drive setLang and assert persistence
      try { if (typeof window !== "undefined") window.__dshTtsI18n = I18N; } catch (e) {}
      let UI_LANG = I18N.current(); // current resolved locale (zh|en)
      function t(key, params) {
        const loc = I18N.dict[UI_LANG] || I18N.dict.en;
        let s = loc[key] !== undefined ? loc[key]
          : I18N.dict.en[key] !== undefined ? I18N.dict.en[key]
          : key;
        // dev aid: a key missing from BOTH dictionaries is a real gap; warn so
        // untranslated keys are caught during development (ignored in prod).
        if (I18N.dict.zh[key] === undefined && typeof console !== "undefined") {
          try { console.warn("[tts i18n] missing key: " + key); } catch (e) {}
        }
        if (params) {
          for (const k of Object.keys(params)) {
            s = String(s).split("{" + k + "}").join(String(params[k]));
          }
        }
        return s;
      }
      // force a re-render on locale change: components that call useI18n()
      // subscribe and bump their own state.
      function useI18n() {
        const [, setN] = react.useState(0);
        react.useEffect(() => I18N.subscribe(() => {
          UI_LANG = I18N.current();
          setN(n => n + 1);
        }), []);
      }
      // Localize a host-side error/response: prefer the host-provided
      // `i18n: { code, params }` tag (translated via t()), else fall back to
      // the plain `error`/`message` (zh fallback) so nothing ever blanks.
      function hostErrText(obj) {
        const i18n = obj && obj.i18n;
        if (i18n && i18n.code && I18N.dict.zh[i18n.code] !== undefined) {
          const translated = t(i18n.code, i18n.params);
          if (translated !== i18n.code) {
            // If the host omitted some params (e.g. version skew), don't show a
            // literal `{placeholder}` — fall back to the full host message too.
            if (translated.includes('{') && obj && (obj.error || obj.message)) {
              return translated + '\n' + String(obj.error || obj.message);
            }
            return translated;
          }
        }
        if (obj && obj.error) return String(obj.error);
        if (obj && obj.message) return String(obj.message);
        return String(obj);
      }
      // ------------------------------------------------------------ /i18n

      // ---------- shared state & audio control ----------
      const shared = {
        autoRead: false,
        voice: "zh-CN-XiaoxuanNeural",
        provider: "edge-tts",
        rvc: {
          baseUrl: "http://127.0.0.1:4892",
          model: "",
          index: "",
          baseSource: "edge",
          baseAudioName: "",
          baseAudioData: "",
          baseVoice: "zh-CN-YunyangNeural",
          baseRate: 0,
          basePitch: 0,
          baseVolume: 0,
          spkId: 0,
          f0File: "",
          f0Method: "rmvpe",
          indexRate: 0.75,
          f0UpKey: 0,
          resampleSr: 40000,
          rmsMixRate: 0.25,
          protect: 0.33,
          filterRadius: 3,
        },
        speaking: false,
        currentText: null,
        speakSource: null,
        speakToken: 0,
        paused: false,       // mini-player: playback paused
        rate: 1,             // mini-player: playback speed (1 / 1.25 / 1.5)
        chunkProgress: null, // { index: 1-based chunk now playing, total } during chunked playback
        currentJobId: null,  // active RVC chunked job, cancelled eagerly on stop
        removedVoices: new Set(), // Edge voices the endpoint rejected (1007) this session
        audioEl: null,
        spareAudioEl: null, // second <audio> used for ping-pong chunk playback (fallback)
        audioCtx: null,     // shared Web Audio context (chunked playback)
        waCleanup: null,    // stop() the active Web Audio chain
        lastSeqBySession: new Map(),
      };

      // ---------- settings persistence (voice / auto-read / provider / rvc) ----------
      // README Known-limits: voice & auto-read used to be in-memory only and reset
      // on refresh. Persist the user's settings to localStorage and restore them on
      // load, so refresh / reopen doesn't lose the choice.
      const SETTINGS_KEY = "dsh-tts-settings";
      const RVC_DEFAULTS = {
        baseUrl: "http://127.0.0.1:4892",
        model: "",
        index: "",
        baseSource: "edge",
        baseAudioName: "",
        baseAudioData: "",
        baseVoice: "zh-CN-YunyangNeural",
        baseRate: 0,
        basePitch: 0,
        baseVolume: 0,
        spkId: 0,
        f0File: "",
        f0Method: "rmvpe",
        indexRate: 0.75,
        f0UpKey: 0,
        resampleSr: 40000,
        rmsMixRate: 0.25,
        protect: 0.33,
        filterRadius: 3,
      };
      const sharedDefaults = {
        autoRead: false,
        voice: "zh-CN-XiaoxuanNeural",
        provider: "edge-tts",
      };
      function loadSettings() {
        try {
          const store = globalThis.localStorage;
          if (!store) return;
          const raw = store.getItem(SETTINGS_KEY);
          if (!raw) return;
          const data = JSON.parse(raw);
          if (typeof data.autoRead === "boolean") shared.autoRead = data.autoRead;
          if (typeof data.voice === "string") shared.voice = data.voice;
          if (data.provider === "edge-tts" || data.provider === "rvc")
            shared.provider = data.provider;
          if (data.rvc && typeof data.rvc === "object") {
            for (const k in RVC_DEFAULTS) {
              if (k in data.rvc) shared.rvc[k] = data.rvc[k];
            }
          }
        } catch (e) {
          /* bad/corrupt stored settings — keep defaults */
        }
      }
      function saveSettings() {
        try {
          const store = globalThis.localStorage;
          if (!store) return;
          const data = {
            autoRead: shared.autoRead,
            voice: shared.voice,
            provider: shared.provider,
            rvc: Object.assign({}, shared.rvc),
          };
          store.setItem(SETTINGS_KEY, JSON.stringify(data));
        } catch (e) {
          /* non-fatal */
        }
      }
      function resetSettings() {
        shared.autoRead = sharedDefaults.autoRead;
        shared.voice = sharedDefaults.voice;
        shared.provider = sharedDefaults.provider;
        for (const k in RVC_DEFAULTS) shared.rvc[k] = RVC_DEFAULTS[k];
        try {
          const store = globalThis.localStorage;
          if (store) store.removeItem(SETTINGS_KEY);
        } catch (e) {}
        notify();
      }
      loadSettings();
      try {
        if (typeof window !== "undefined")
          window.__dshTtsSettings = {
            get: () => ({
              autoRead: shared.autoRead,
              voice: shared.voice,
              provider: shared.provider,
              rvc: Object.assign({}, shared.rvc),
            }),
            save: saveSettings,
            reset: resetSettings,
          };
      } catch (e) {}
      const listeners = new Set();
      function notify() {
        for (const fn of listeners) {
          try {
            fn();
          } catch (e) {}
        }
      }
      function useSharedForce() {
        const [, setN] = react.useState(0);
        react.useEffect(() => {
          const fn = () => setN(n => n + 1);
          listeners.add(fn);
          return () => listeners.delete(fn);
        }, []);
      }

      function plainText(text) {
        return String(text || "")
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/`([^`]*)`/g, "$1")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/__([^_]+)__/g, "$1")
          .replace(/~~([^~]+)~~/g, "$1")
          .replace(/^\s*[-*+]\s+/gm, "")
          .replace(/^\s*\d+\.\s+/gm, "")
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\n\s*/g, " ")
          .trim();
      }

      function extractText(blocks) {
        let text = "";
        if (blocks) {
          for (const b of blocks) {
            if (b && b.kind === "text" && typeof b.text === "string")
              text += (text ? "\n" : "") + b.text;
          }
        }
        return text;
      }

      function clearSpeaking(token) {
        if (token === shared.speakToken) {
          shared.speaking = false;
          shared.currentText = null;
          shared.speakSource = null;
          shared.chunkProgress = null;
          shared.currentJobId = null;
          shared.paused = false;
          shared.rate = 1;
          notify();
        }
      }

      function stopSpeaking() {
        shared.speakToken += 1;
        shared.speaking = false;
        shared.currentText = null;
        shared.speakSource = null;
        shared.chunkProgress = null;
        shared.paused = false;
        shared.rate = 1;
        const el = shared.audioEl;
        if (el) {
          try {
            el.pause();
          } catch (e) {}
          try {
            el.removeAttribute("src");
          } catch (e) {}
        }
        const el2 = shared.spareAudioEl;
        if (el2) {
          try {
            el2.pause();
          } catch (e) {}
          try {
            el2.removeAttribute("src");
          } catch (e) {}
        }
        if (shared.waCleanup) {
          try {
            shared.waCleanup();
          } catch (e) {}
          shared.waCleanup = null;
        }
        // Eagerly cancel the RVC chunked job so the local conversion service
        // stops scheduling new chunks and the Host releases the job promptly
        // (no waiting for the lazy GC). Best-effort, fire-and-forget.
        const job = shared.currentJobId;
        shared.currentJobId = null;
        if (job) {
          try {
            fetch(
              "/dsh-tts-api/rvc-next?job=" + encodeURIComponent(job) + "&cancel=1",
            ).catch(() => {});
          } catch (e) {}
        }
        notify();
      }

      function stopIfSource(source) {
        if (shared.speakSource === source) stopSpeaking();
      }

      // Edge TTS 端点移除音色（1007）时自愈：prune 掉该音色并回退默认，
      // 让用户下次不再选到已失效音色（比反复报错更有用）。只有 Edge 模式适用。
      function pruneRemovedVoice(errorText) {
        const voice = shared.voice;
        const text = String(errorText || "");
        if (!voice || shared.provider === "rvc") return false;
        if (!/1007|unsupported\s+voice|not\s+support/i.test(text)) return false;
        shared.removedVoices.add(voice);
        shared.voice = "zh-CN-XiaoxuanNeural";
        notify();
        return true;
      }

      // ---------- mini player: pause/resume + speed ----------
      const SPEEDS = [1, 1.25, 1.5];
      function formatRate(r) {
        return r === 1 ? "1x" : r + "x";
      }
      function applySpeedToEl() {
        const el = shared.audioEl;
        if (el) {
          try {
            el.playbackRate = shared.rate;
            const el2 = shared.spareAudioEl;
            if (el2) el2.playbackRate = shared.rate;
          } catch (e) {}
        }
      }
      function togglePause() {
        shared.paused = !shared.paused;
        if (shared.waCleanup) {
          // Web Audio chunked path: suspend/resume the shared context (gapless-safe)
          const ctx = shared.audioCtx;
          if (ctx) {
            if (shared.paused) {
              try { ctx.suspend(); } catch (e) {}
            } else {
              try { ctx.resume(); } catch (e) {}
            }
          }
        } else {
          // single-URL <audio> path
          const el = shared.audioEl;
          if (el) {
            if (shared.paused) {
              try { el.pause(); } catch (e) {}
            } else {
              try { el.play().catch(() => {}); } catch (e) {}
            }
          }
        }
        notify();
      }
      function cycleSpeed() {
        const i = SPEEDS.indexOf(shared.rate);
        shared.rate = SPEEDS[(i < 0 ? 0 : i + 1) % SPEEDS.length];
        applySpeedToEl();
        notify();
      }

      async function rpcSpeak(text, voice) {
        const payload = { text, voice, provider: shared.provider };
        const pct = v =>
          v === 0 ? "default" : (v > 0 ? "+" : "") + v + "%";
        if (shared.provider === "rvc") {
          const r = shared.rvc;
          const custom = Object.assign({}, r, {
            baseRate: pct(r.baseRate),
            basePitch: pct(r.basePitch),
            baseVolume: pct(r.baseVolume),
          });
          if (r.baseSource !== "upload") {
            custom.baseAudioBase64 = "";
            custom.baseAudioName = "";
          }
          payload.custom = custom;
        } else {
          payload.prosody = {
            rate: pct(shared.rvc.baseRate),
            pitch: pct(shared.rvc.basePitch),
            volume: pct(shared.rvc.baseVolume),
          };
        }
        const response = await fetch("/dsh-tts-api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return await response.json();
      }

      async function fetchNextChunk(jobId, token) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 200000);
        try {
          const r = await fetch(
            "/dsh-tts-api/rvc-next?job=" + encodeURIComponent(jobId),
            { signal: ctrl.signal },
          );
          return await r.json().catch(() => ({ done: true }));
        } catch (e) {
          return { done: true, error: String((e && e.message) || e) };
        } finally {
          clearTimeout(timer);
        }
      }

      // Web Audio chunk player: decodes each chunk into an AudioBuffer and
      // schedules the sources back-to-back on the sample clock
      // (start(prevEnd) — sample-accurate, gapless by construction). The server
      // already trims per-chunk edge silence; decoding stays 2 buffers ahead so
      // the chain never falls behind.
      async function playChunks(jobId, initialUrls, total, token, onError) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return playChunksAudio(jobId, initialUrls, total, token, onError);
        let ctx = shared.audioCtx;
        if (!ctx) {
          try {
            ctx = shared.audioCtx = new AC();
          } catch (e) {
            return playChunksAudio(jobId, initialUrls, total, token, onError);
          }
        }
        if (ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch (e) { /* keep going; start() clamps to currentTime */ }
        }
        const queue = initialUrls.slice();
        let cursor = 0;       // next queue index to decode
        let completed = false; // host reported no more chunks
        let inFlight = null;
        let nextStart = ctx.currentTime + 0.05; // schedule cursor (sample clock)
        let decoded = 0;      // sources scheduled
        let played = 0;       // sources that ended
        let finished = false;
        const sources = new Set();
        let master = null;
        try {
          master = ctx.createGain();
          master.connect(ctx.destination);
        } catch (e) {
          return playChunksAudio(jobId, initialUrls, total, token, onError);
        }
        const setProgress = index => {
          shared.chunkProgress = { index: Math.min(index, total), total };
          notify();
        };
        const requestNext = () => {
          if (completed || inFlight) return;
          inFlight = fetchNextChunk(jobId, token)
            .then(r => {
              inFlight = null;
              if (token !== shared.speakToken) return;
              if (r && r.url) queue.push(r.url);
              else if (r && r.error) {
                completed = true;
                if (typeof onError === "function") onError(t("err.chunkFail") + r.error);
              } else {
                completed = true;
              }
            })
            .catch(() => {
              inFlight = null;
              completed = true;
            });
        };
        const decode = async url => {
          const r = await fetch(url);
          if (!r.ok) throw new Error("HTTP " + r.status);
          return await ctx.decodeAudioData(await r.arrayBuffer());
        };
        const schedule = buf => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.playbackRate.value = shared.rate || 1; // mini-player speed
          src.connect(master);
          src.start(nextStart);
          nextStart += buf.duration / (shared.rate || 1); // wall-clock-consistent
          sources.add(src);
          const k = decoded;
          src.onended = () => {
            sources.delete(src);
            if (token !== shared.speakToken) return;
            played++;
            setProgress(k + 2);
            if (played >= total) finish();
          };
          decoded++;
        };
        const cleanup = () => {
          for (const s of sources) {
            try {
              s.stop();
            } catch (e) {}
          }
          sources.clear();
          try {
            master.disconnect();
          } catch (e) {}
        };
        const finish = () => {
          if (finished) return;
          finished = true;
          if (shared.waCleanup === cleanup) shared.waCleanup = null;
          cleanup();
          if (token === shared.speakToken) clearSpeaking(token);
        };
        shared.waCleanup = () => {
          if (finished) return;
          finished = true;
          if (shared.waCleanup === cleanup) shared.waCleanup = null;
          cleanup();
        };
        try {
          setProgress(1);
          while (token === shared.speakToken && !finished) {
            if (queue.length - cursor >= 2) requestNext(); // top up URL queue
            if (cursor < queue.length && decoded - played < 2) {
              const url = queue[cursor++];
              try {
                const buf = await decode(url);
                if (token !== shared.speakToken) break;
                schedule(buf);
              } catch (e) {
                if (typeof onError === "function")
                  onError(t("err.audioDecode") + String((e && e.message) || e));
                break;
              }
              continue;
            }
            requestNext();
            await new Promise(r => setTimeout(r, 200));
          }
        } finally {
          finish();
        }
      }

      // Fallback chunk player (no Web Audio): two <audio> elements ping-pong;
      // the next chunk's data preloads during the current chunk's playback.
      async function playChunksAudio(jobId, initialUrls, total, token, onError) {
        const elA = shared.audioEl;
        const elB = document.createElement("audio");
        elB.preload = "auto";
        elB.style.display = "none";
        document.body.appendChild(elB);
        shared.spareAudioEl = elB;
        const queue = initialUrls.slice();
        let cursor = 0;
        let completed = false; // host reported no more chunks
        let inFlight = null;
        let cur = elA;
        let spare = elB;
        const setProgress = index => {
          shared.chunkProgress = { index, total };
          notify();
        };
        const requestNext = () => {
          if (completed || inFlight) return;
          inFlight = fetchNextChunk(jobId, token)
            .then(r => {
              inFlight = null;
              if (token !== shared.speakToken) return;
              if (r && r.url) queue.push(r.url);
              else if (r && r.error) {
                completed = true;
                if (typeof onError === "function") onError(t("err.chunkFail") + r.error);
              } else {
                completed = true;
              }
            })
            .catch(() => {
              inFlight = null;
              completed = true;
            });
        };
        const playOne = (url, index) =>
          new Promise(resolve => {
            if (token !== shared.speakToken) return resolve();
            setProgress(index);
            let done = false;
            const fin = () => {
              if (done) return;
              done = true;
              cur.onended = null;
              cur.onerror = null;
              resolve();
            };
            cur.onended = fin;
            cur.onerror = () => {
              fin();
              if (typeof onError === "function") onError(t("err.chunkSkip"));
            };
            if (cur.getAttribute("src") !== url) {
              cur.src = url;
              cur.load();
            }
            try { cur.playbackRate = shared.rate || 1; } catch (e) {}
            cur.play().catch(fin);
          });
        try {
          while (token === shared.speakToken) {
            if (queue.length - cursor >= 2) requestNext(); // top up while comfortably buffered
            if (cursor < queue.length) {
              const url = queue[cursor];
              const after = queue[cursor + 1];
              // preload the NEXT chunk's audio into the spare element while the
              // current chunk plays (full chunk-duration of lead time)
              if (after && spare.getAttribute("src") !== after) {
                spare.src = after;
                spare.load();
                try { spare.playbackRate = shared.rate || 1; } catch (e) {}
              }
              await playOne(url, cursor + 1);
              // swap: the buffered spare becomes the player; the just-finished
              // element becomes the next preload target
              const t = cur;
              cur = spare;
              spare = t;
              cursor++;
              continue;
            }
            requestNext();
            if (!inFlight) break; // nothing buffered, nothing coming
            await new Promise(r => setTimeout(r, 200));
          }
        } finally {
          if (token === shared.speakToken) clearSpeaking(token);
          try { elB.pause(); } catch (e) {}
          try { elB.removeAttribute("src"); } catch (e) {}
          try { document.body.removeChild(elB); } catch (e) {}
          shared.spareAudioEl = null;
        }
      }

      async function speakText(rawText, source, onError) {
        const trimmed = plainText(rawText);
        if (!trimmed) return { ok: false, error: "empty text" };
        if (shared.speaking && shared.currentText === trimmed) {
          stopSpeaking();
          return { ok: true, stopped: true };
        }
        stopSpeaking();
        const token = ++shared.speakToken;
        shared.speaking = true;
        shared.currentText = trimmed;
        shared.speakSource = source || "manual";
        notify();
        try {
          const result = await rpcSpeak(trimmed, shared.voice);
          if (token !== shared.speakToken)
            return { ok: false, error: "interrupted" };
          if (!result || result.error) {
            const errText = String(
              (result && result.error) || t("err.synthFailShort"),
            );
            const pruned = pruneRemovedVoice(errText);
            clearSpeaking(token);
            console.error("[tts] synthesize failed:", errText);
            if (pruned && typeof onError === "function") onError(t("voice.removed"));
            return { ok: false, error: errText };
          }
          const el = shared.audioEl;
          if (!el) {
            clearSpeaking(token);
            return { ok: false, error: "audio unavailable" };
          }
          // Long RVC read -> chunked progressive playback queue.
          if (Array.isArray(result.chunks) && result.chunks.length) {
            const total = result.total || result.chunks.length;
            shared.currentJobId = result.jobId || null;
            shared.chunkProgress = { index: 1, total };
            notify();
            playChunks(result.jobId, result.chunks, total, token, onError);
            return { ok: true, chunked: true, total };
          }
          shared.currentJobId = null;
          el.onended = () => clearSpeaking(token);
          el.onerror = () => {
            clearSpeaking(token);
            if (typeof onError === "function") onError(t("err.audioLoadRetry"));
          };
          el.src = result.url;
          try { el.playbackRate = shared.rate; } catch (e) {}
          try {
            await el.play();
          } catch (e) {
            clearSpeaking(token);
            console.error("[tts] play failed:", String(e));
            return { ok: false, error: String((e && e.message) || e) };
          }
          return { ok: true };
        } catch (e) {
          const errText2 = String((e && e.message) || e);
          console.error("[tts] rpc failed:", errText2);
          pruneRemovedVoice(errText2);
          clearSpeaking(token);
          return { ok: false, error: errText2 };
        }
      }

      // Export the synthesized audio of a message as a downloadable file. Uses
      // the same in-session cache so a just-read message downloads instantly.
      // Long RVC chunked reads have no single audio file yet -> unsupported.
      async function downloadText(rawText, onError) {
        const plain = plainText(rawText);
        if (!plain) return;
        // Long RVC reads are chunked with no single output file yet; skip rather
        // than starting a wasteful probe+prewarm conversion job on the Host.
        if (
          shared.provider === "rvc" &&
          shared.rvc.baseSource === "edge" &&
          plain.length > 60
        ) {
          if (typeof onError === "function") onError(t("download.notSupported"));
          return;
        }
        try {
          const result = await rpcSpeak(plain, shared.voice);
          if (result && result.error) {
            if (typeof onError === "function") onError(t("download.fail") + result.error);
            return;
          }
          if (result && result.url) {
            const a = document.createElement("a");
            a.href = result.url + "?download=1";
            a.download = "dsh-tts.mp3";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            return;
          }
          if (result && Array.isArray(result.chunks)) {
            if (typeof onError === "function") onError(t("download.notSupported"));
            return;
          }
          if (typeof onError === "function") onError(t("download.fail") + (result && result.error || "?"));
        } catch (e) {
          if (typeof onError === "function")
            onError(t("download.fail") + String((e && e.message) || e));
        }
      }

      // ---------- icons ----------
      function SpeakerIcon() {
        return react.createElement(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 16,
            height: 16,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.2,
            "aria-hidden": true,
          },
          react.createElement("path", {
            d: "M2.5 6v4h2.5L8 12.5v-9L5 6H2.5z",
            fill: "currentColor",
            stroke: "none",
          }),
          react.createElement("path", { d: "M10 6.2a3 3 0 0 1 0 3.6" }),
          react.createElement("path", { d: "M11.4 4.6a5 5 0 0 1 0 6.8" }),
        );
      }
      function HeadphonesIcon() {
        return react.createElement(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 15,
            height: 15,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.4,
            "aria-hidden": true,
          },
          react.createElement("path", { d: "M3 9a5 5 0 0 1 10 0" }),
          react.createElement("path", {
            d: "M2.5 8.5v3a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 0-.5.5z",
            fill: "currentColor",
            stroke: "none",
          }),
          react.createElement("path", {
            d: "M13.5 8.5v3a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5z",
            fill: "currentColor",
            stroke: "none",
          }),
        );
      }
      function EqualizerIcon() {
        return react.createElement(
          "span",
          { className: "dsh-tts-eq", "aria-hidden": true },
          react.createElement("span", { className: "dsh-tts-eq-bar" }),
          react.createElement("span", { className: "dsh-tts-eq-bar" }),
          react.createElement("span", { className: "dsh-tts-eq-bar" }),
        );
      }
      function PauseIcon() {
        return react.createElement(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 15,
            height: 15,
            fill: "currentColor",
            "aria-hidden": true,
          },
          react.createElement("rect", { x: 4.2, y: 3, width: 2.6, height: 10, rx: 1 }),
          react.createElement("rect", { x: 9.2, y: 3, width: 2.6, height: 10, rx: 1 }),
        );
      }
      function PlayIcon() {
        return react.createElement(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 15,
            height: 15,
            fill: "currentColor",
            "aria-hidden": true,
          },
          react.createElement("path", {
            d: "M5 3.4v9.2c0 .7.8 1.1 1.4.7l6.6-4.6c.5-.4.5-1.1 0-1.5L6.4 2.7c-.6-.4-1.4 0-1.4.7z",
          }),
        );
      }
      function DownloadIcon() {
        return react.createElement(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 15,
            height: 15,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.4,
            "aria-hidden": true,
          },
          react.createElement("path", { d: "M8 2.5v7" }),
          react.createElement("path", { d: "M5 6.5l3 3 3-3" }),
          react.createElement("path", { d: "M3 11v1.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V11" }),
        );
      }
      function SpinnerIcon() {
        return react.createElement("span", {
          className: "dsh-tts-spinner",
          "aria-hidden": true,
        });
      }

      // ---------- styles ----------
      const CSS =
        ".dsh-tts-toggle{width:28px;height:28px;flex:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:999px;place-items:center;display:grid}" +
        ".dsh-tts-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}" +
        ".dsh-tts-toggle[data-active]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-auto-pill{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none;order:1}" +
        ".dsh-tts-auto-pill:hover{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-auto-pill[data-active]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
        ".dsh-tts-auto-label{font-size:12px;line-height:1}" +
        ".dsh-tts-auto-dot{width:7px;height:7px;border-radius:50%;border:1.5px solid currentColor;flex:none}" +
        ".dsh-tts-auto-pill[data-active] .dsh-tts-auto-dot{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}" +
        'div[class*="_tools"]>.dsh-tts-auto-pill{order:1}' +
        'div[class*="_tools"]>div[class*="_modes"]{order:2}' +
        'div[class*="_tools"]>.dsh-tts-toggle{order:1}' +
        ".dsh-tts-action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}" +
        ".dsh-tts-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}" +
        ".dsh-tts-action:disabled{cursor:default;opacity:.4}" +
        ".dsh-tts-action[data-active]{color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-mini{display:inline-flex;align-items:center;gap:2px}" +
        ".dsh-tts-mini .dsh-tts-action{width:26px;height:26px;padding:5px}" +
        ".dsh-tts-dl-err{font-size:11px;line-height:16px;color:var(--dsw-alias-label-error);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".dsh-tts-dl-err[role=alert]{font-size:11px;color:var(--dsw-alias-label-error)}" +
        ".dsh-tts-sel-wrap{position:fixed;z-index:1200;transform:translateX(-50%)}" +
        ".dsh-tts-sel-btn{height:26px;padding:0 11px;border:none;border-radius:999px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);font-size:12px;font-family:inherit;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap}" +
        ".dsh-tts-sel-btn:hover{opacity:.9}" +
        ".dsh-tts-speed-label{font-size:11px;font-weight:600;line-height:1;min-width:22px;text-align:center}" +
        ".dsh-tts-chunk-pill{font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);padding:0 2px;white-space:nowrap;font-variant-numeric:tabular-nums}" +
        "[data-tts-tip]{position:relative}" +
        "[data-tts-tip]:hover::after{content:attr(data-tts-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;font-size:12px;line-height:14px;z-index:300;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none}" +
        "[data-tts-tip]:hover::before{content:\"\";position:absolute;bottom:calc(100% + 2px);left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--dsw-alias-border-l2);z-index:300;pointer-events:none}" +
        ".dsh-tts-eq{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;gap:2px}" +
        ".dsh-tts-eq-bar{width:2.5px;border-radius:1px;background:currentColor;height:6px;animation:dsh-tts-eq-bounce .9s ease-in-out infinite}" +
        ".dsh-tts-eq-bar:nth-child(1){animation-delay:0s}" +
        ".dsh-tts-eq-bar:nth-child(2){animation-delay:.15s}" +
        ".dsh-tts-eq-bar:nth-child(3){animation-delay:.3s}" +
        "@keyframes dsh-tts-eq-bounce{0%,100%{height:5px}50%{height:13px}}" +
        ".dsh-tts-settings{display:flex;flex-direction:column}" +
        ".dsh-tts-module{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 4px;border-bottom:1px solid var(--dsw-alias-border-secondary)}" +
        ".dsh-tts-module:last-child{border-bottom:none}" +
        ".dsh-tts-module-stack{flex-direction:column;align-items:stretch;gap:10px}" +
        ".dsh-tts-module-info{min-width:0}" +
        ".dsh-tts-module-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-module-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-top:2px}" +
        ".dsh-tts-select{max-width:300px;height:34px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit;color-scheme:light dark}" +
        ".dsh-tts-select option{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-select:hover{border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
        ".dsh-tts-preview-row{display:flex;align-items:center;gap:8px;width:100%}" +
        ".dsh-tts-preview-input{flex:1;min-width:0;height:34px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit}" +
        ".dsh-tts-preview-input:hover{border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-preview-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
        ".dsh-tts-preview-btn{width:38px;height:34px;flex:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border:none;border-radius:9px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);transition:background-color .15s ease,transform .1s ease,opacity .15s ease}" +
        ".dsh-tts-preview-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-primary);opacity:.88;transform:scale(1.05)}" +
        ".dsh-tts-preview-btn:active:not(:disabled){transform:scale(.95)}" +
        ".dsh-tts-preview-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}" +
        ".dsh-tts-preview-btn:disabled{cursor:default;opacity:.55}" +
        ".dsh-tts-spinner{width:15px;height:15px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:dsh-tts-spin .8s linear infinite}" +
        "@keyframes dsh-tts-spin{to{transform:rotate(360deg)}}" +
        ".dsh-tts-error{font-size:12px;line-height:18px;color:var(--dsw-alias-label-error);padding:2px 4px 0;white-space:pre-line}" +
        ".dsh-tts-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:2px 4px 0}" +
        ".dsh-tts-rvc{background:var(--dsw-alias-bg-layer-2,transparent);border-radius:10px;padding:2px 10px 10px}" +
        ".dsh-tts-onboard{background:var(--dsw-alias-bg-layer-2,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px;margin-bottom:4px}" +
        ".dsh-tts-onboard-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-onboard-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:2px}" +
        ".dsh-tts-onboard-steps{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);margin-top:6px;white-space:pre-line}" +
        ".dsh-tts-onboard-cmd{margin:8px 0 0;padding:8px 10px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow:auto;max-height:160px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}" +
        ".dsh-tts-field{margin:8px 0}" +
        ".dsh-tts-rvc-row{display:flex;align-items:center;gap:10px;min-width:0}" +
        ".dsh-tts-rvc-label{flex:none;width:110px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:right}" +
        ".dsh-tts-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin:3px 0 0 120px;font-style:italic}" +
        ".dsh-tts-rvc-input{flex:1;min-width:0;height:30px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px;font-size:12px;font-family:inherit}" +
        ".dsh-tts-rvc-input:hover{border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-rvc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
        ".dsh-tts-rvc-input-num{flex:none;max-width:96px}" +
        ".dsh-tts-path{flex:1;min-width:0;display:flex;align-items:center;gap:6px}" +
        ".dsh-tts-path .dsh-tts-rvc-input{flex:0 0 80%;max-width:none}" +
        ".dsh-tts-browse{flex:none;height:30px;padding:0 12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit}" +
        ".dsh-tts-browse:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-upload{flex:1;min-width:0;display:flex;align-items:center;gap:8px}" +
        ".dsh-tts-file-btn{flex:none;height:30px;padding:0 12px;cursor:pointer;display:inline-flex;align-items:center;border:none;border-radius:8px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);font-size:12px;font-family:inherit}" +
        ".dsh-tts-file-btn:hover{opacity:.9}" +
        ".dsh-tts-upload-name{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".dsh-tts-picker{font-style:normal;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;max-height:180px;overflow:auto}" +
        ".dsh-tts-compact{margin-top:6px;padding:8px;background:var(--dsw-alias-bg-layer-2,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}" +
        ".dsh-tts-compact-row{display:flex;align-items:center;gap:8px;margin-top:6px}" +
        ".dsh-tts-compact-src{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".dsh-tts-compact-btn{flex:none;height:26px;padding:0 10px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit}" +
        ".dsh-tts-compact-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}" +
        ".dsh-tts-compact-btn:disabled{cursor:default;opacity:.55}" +
        ".dsh-tts-compact-info{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:6px}" +
        ".dsh-tts-compact-ok{color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-compact-select{flex:none;height:26px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 8px;font-size:12px;font-family:inherit}" +
        ".dsh-tts-pack-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;margin-top:6px;background:var(--dsw-alias-bg-layer-2,transparent)}" +
        ".dsh-tts-pack-head{display:flex;align-items:center;gap:8px;justify-content:space-between}" +
        ".dsh-tts-pack-name{font-size:13px;color:var(--dsw-alias-label-primary);font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".dsh-tts-pack-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;line-height:16px}" +
        ".dsh-tts-pack-btn{flex:none;height:26px;padding:0 10px;cursor:pointer;border:none;border-radius:7px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);font-size:12px;font-family:inherit}" +
        ".dsh-tts-pack-btn:hover:not(:disabled){opacity:.88}" +
        ".dsh-tts-pack-btn:disabled{cursor:default;opacity:.55}" +
        ".dsh-tts-pack-btn[data-done]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-pack-head-actions{flex:none;display:flex;align-items:center;gap:6px}" +
        ".dsh-tts-pack-uninstall{background:transparent;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2)}" +
        ".dsh-tts-pack-uninstall:hover{color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-label-error)}" +
        ".dsh-tts-overlay{position:fixed;inset:0;z-index:40}" +
        ".dsh-tts-picker{position:relative;z-index:41}" +
        ".dsh-tts-diag{display:flex;flex-direction:column;gap:6px;margin-top:8px}" +
        ".dsh-tts-diag-row{display:flex;align-items:baseline;gap:8px;font-size:12px;line-height:18px}" +
        ".dsh-tts-diag-mark{flex:none;width:16px;text-align:center}" +
        ".dsh-tts-diag-name{flex:none;width:110px;color:var(--dsw-alias-label-secondary);text-align:right}" +
        ".dsh-tts-diag-detail{min-width:0;color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-diag-ok{color:var(--dsw-alias-label-success,var(--dsw-alias-label-primary))}" +
        ".dsh-tts-diag-fail{color:var(--dsw-alias-label-error)}" +
        ".dsh-tts-diag-warn{color:var(--dsw-alias-label-warning,var(--dsw-alias-label-secondary))}" +
        ".dsh-tts-pack-progress{flex:none;width:130px;display:flex;flex-direction:column;gap:3px}" +
        ".dsh-tts-pack-progress-bar{height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover,transparent);overflow:hidden}" +
        ".dsh-tts-pack-progress-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}" +
        ".dsh-tts-pack-progress-text{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}" +
        ".dsh-tts-picker-title{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}" +
        ".dsh-tts-picker-item{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;cursor:pointer;background:transparent;border:none;border-radius:6px;padding:4px 6px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:left;font-family:inherit}" +
        ".dsh-tts-picker-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-picker-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".dsh-tts-picker-size{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
        ".dsh-tts-slider{flex:1;min-width:0}" +
        ".dsh-tts-slider input[type=range]{width:100%;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}" +
        ".dsh-tts-slider-scale{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}" +
        ".dsh-tts-slider-value{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums;min-width:36px;text-align:right;margin-left:8px}" +
        ".dsh-tts-slider-end{white-space:nowrap}" +
        ".dsh-tts-slider-spacer{flex:1}" +
        ".dsh-tts-advanced{margin-top:2px}" +
        ".dsh-tts-advanced summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);padding:4px 0;user-select:none}" +
        ".dsh-tts-advanced summary:hover{color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-advanced[open] summary{margin-bottom:6px}" +
        ".dsh-tts-footnote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:10px 4px 4px}";

      function insertCss(css) {
        const tag = document.createElement("style");
        tag.dataset.pluginCss = "dsh-plugin-tts";
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => {
          if (tag.parentNode) tag.parentNode.removeChild(tag);
        };
      }
      ctx.effect(() => insertCss(CSS), "dsh-plugin-tts: styles");

      // ---------- autoplay unlock ----------
      // Browsers block programmatic audio playback until a user gesture. Capture
      // the very first user interaction to eagerly lift that restriction for both
      // the shared Web Audio context and the <audio> host, so a read (or an
      // auto-read) started right after isn't silently blocked by autoplay policy.
      // ~50ms silent WAV (8000Hz mono) used only to "unlock" the <audio> path.
      const SILENT_WAV =
        "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
      let authUnlockEl = null;
      function unlockAudio() {
        try {
          if (typeof window !== "undefined") {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!shared.audioCtx && AC) shared.audioCtx = new AC();
            const c = shared.audioCtx;
            if (c && c.state === "suspended") c.resume().catch(() => {});
          }
        } catch (e) {}
        try {
          if (!authUnlockEl && typeof document !== "undefined") {
            authUnlockEl = document.createElement("audio");
            authUnlockEl.muted = true;
            authUnlockEl.style.display = "none";
            authUnlockEl.setAttribute("src", SILENT_WAV);
            authUnlockEl.load();
            document.body.appendChild(authUnlockEl);
          }
        } catch (e) {}
        if (authUnlockEl) {
          try {
            authUnlockEl.play().catch(() => {});
          } catch (e) {}
        }
      }
      function setupAutoplayUnlock() {
        const events = ["pointerdown", "pointerup", "keydown", "touchstart", "mousedown"];
        const handler = () => {
          unlockAudio();
          for (const ev of events) {
            try {
              document.removeEventListener(ev, handler, true);
            } catch (e) {}
          }
        };
        for (const ev of events) {
          try {
            document.addEventListener(ev, handler, true);
          } catch (e) {}
        }
        return () => {
          for (const ev of events) {
            try {
              document.removeEventListener(ev, handler, true);
            } catch (e) {}
          }
        };
      }
      ctx.effect(setupAutoplayUnlock, "dsh-plugin-tts: autoplay unlock");

      // ---------- keyboard shortcuts (a11y) ----------
      // Esc or S stops the current read-aloud (and clears any active RVC chunked
      // job). Guarded so it never fires while the user is typing in an input /
      // textarea / contenteditable — avoids hijacking normal editing keys.
      function setupKeyboardShortcuts() {
        const handler = e => {
          try {
            const t = e.target;
            const tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
            const editable =
              tag === "input" ||
              tag === "textarea" ||
              tag === "select" ||
              (t && t.isContentEditable);
            if (editable) return;
            const k = String(e.key || "").toLowerCase();
            if ((k === "escape" || k === "s") && shared.speaking) {
              e.preventDefault();
              stopSpeaking();
            }
          } catch (err) {}
        };
        try {
          document.addEventListener("keydown", handler, true);
        } catch (e) {}
        return () => {
          try {
            document.removeEventListener("keydown", handler, true);
          } catch (e) {}
        };
      }
      ctx.effect(setupKeyboardShortcuts, "dsh-plugin-tts: keyboard shortcuts");

      // ---------- read selected text (F4) ----------
      // A small floating "朗读选中" chip appears near a text selection in the
      // conversation; clicking it reads the selected text. Guarded so it never
      // shows for selections inside inputs/textareas and self-cleans on click
      // elsewhere / scroll.
      function setupSelectionRead() {
        let wrap = null;
        function hide() { if (wrap) wrap.style.display = "none"; }
        function ensure() {
          if (wrap) return wrap;
          try {
            wrap = document.createElement("div");
            wrap.className = "dsh-tts-sel-wrap";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "dsh-tts-sel-btn";
            btn.textContent = t("sel.read");
            btn.addEventListener("click", e => {
              e.stopPropagation();
              try {
                const sel = window.getSelection && window.getSelection();
                const s = sel && sel.toString ? sel.toString().trim() : "";
                if (s) speakText(s, "manual");
              } catch (err) {}
              hide();
            });
            wrap.appendChild(btn);
            document.body.appendChild(wrap);
            wrap.style.display = "none";
          } catch (e) {
            wrap = null;
          }
          return wrap;
        }
        function onMouseUp() {
          try {
            const sel = window.getSelection && window.getSelection();
            const s = sel && sel.toString ? sel.toString().trim() : "";
            if (!s) { hide(); return; }
            const node = sel.anchorNode;
            const el =
              node && node.nodeType === 1
                ? node
                : node && node.parentElement;
            const tag = el && el.tagName ? el.tagName.toLowerCase() : "";
            if (tag === "input" || tag === "textarea") { hide(); return; }
            const range = sel.rangeCount ? sel.getRangeAt(0) : null;
            const rect = range ? range.getBoundingClientRect() : null;
            if (!rect || (!rect.width && !rect.height)) { hide(); return; }
            const w = ensure();
            if (!w) return;
            w.style.left = rect.left + rect.width / 2 + "px";
            w.style.top = Math.max(0, rect.top - 36) + "px";
            w.style.display = "block";
          } catch (e) {
            hide();
          }
        }
        function onDown() { setTimeout(hide, 120); }
        function onScroll() { hide(); }
        try {
          document.addEventListener("mouseup", onMouseUp, true);
          document.addEventListener("mousedown", onDown, true);
          document.addEventListener("scroll", onScroll, true);
          window.addEventListener("scroll", onScroll, true);
        } catch (e) {}
        return () => {
          try {
            document.removeEventListener("mouseup", onMouseUp, true);
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("scroll", onScroll, true);
          } catch (e) {}
        };
      }
      ctx.effect(setupSelectionRead, "dsh-plugin-tts: selection read");

      // ---------- audio host (hidden <audio> in shell.overlay) ----------
      function TtsAudioHost() {
        react.useEffect(
          () => () => {
            shared.audioEl = null;
          },
          [],
        );
        return react.createElement("audio", {
          ref: el => {
            shared.audioEl = el;
          },
          style: { display: "none" },
          preload: "auto",
        });
      }
      slots.inject("shell.overlay", () =>
        slots.register(
          { name: "shell.overlay", key: "tts-audio-host", id: "tts-audio-host", order: 1000 },
          TtsAudioHost,
        ),
      );

      // ---------- 1) input.left: auto-read toggle + watcher ----------
      function AutoReadToggle(props) {
        useI18n();
        const [on, setOn] = react.useState(shared.autoRead);
        react.useEffect(
          () => () => {
            stopIfSource("auto");
          },
          [],
        );
        react.useEffect(() => {
          const session = props.session;
          if (!session) return;
          let maxSeq = -1;
          let newest = null;
          const nodes = session.nodes;
          if (nodes) {
            for (const n of nodes) {
              if (
                n &&
                n.kind === "assistant" &&
                typeof n.messageId === "string" &&
                n.seq > maxSeq
              ) {
                maxSeq = n.seq;
                newest = n;
              }
            }
          }
          if (!newest) return;
          const key = props.sessionId;
          const prev = shared.lastSeqBySession.get(key);
          if (prev === undefined) {
            shared.lastSeqBySession.set(key, maxSeq);
            return;
          }
          if (maxSeq > prev) {
            shared.lastSeqBySession.set(key, maxSeq);
            if (shared.autoRead) {
              const text = extractText(newest.blocks);
              if (text.trim()) speakText(text, "auto");
            }
          }
        }, [props.session]);
        const onClick = () => {
          const next = !shared.autoRead;
          shared.autoRead = next;
          saveSettings();
          setOn(next);
          if (!next) stopIfSource("auto");
        };
        return react.createElement(
          "button",
          {
            type: "button",
            className: "dsh-tts-auto-pill",
            "data-active": on || undefined,
            "aria-label": on ? t("autoRead.on") : t("autoRead.off"),
            "aria-pressed": on || undefined,
            "data-tts-tip": on
              ? t("autoRead.on.title")
              : t("autoRead.off.title"),
            onClick: onClick,
          },
          HeadphonesIcon(),
          react.createElement(
            "span",
            { className: "dsh-tts-auto-label" },
            t("autoRead.label"),
          ),
          react.createElement("span", { className: "dsh-tts-auto-dot" }),
        );
      }
      slots.inject("conversation.input.left", () =>
        slots.register(
          { name: "conversation.input.left", key: "tts-autoread", id: "tts-autoread", order: 20 },
          AutoReadToggle,
        ),
      );

      // ---------- 2) assistant-actions: per-message read-aloud button ----------
      function ReadAloudButton(props) {
        useI18n();
        useSharedForce();
        const useSession = props.useSession;
        let nodes = null;
        if (useSession) nodes = useSession(s => s.nodes);
        let node = null;
        if (nodes) {
          for (const n of nodes) {
            if (
              n &&
              n.kind === "assistant" &&
              n.messageId === props.messageId
            ) {
              node = n;
              break;
            }
          }
        }
        const raw = node ? extractText(node.blocks) : "";
        const plain = plainText(raw);
        const isPlaying =
          shared.speaking && !!plain && shared.currentText === plain;
        const cp = shared.chunkProgress;
        const playingLabel = isPlaying
          ? cp && cp.total > 1
            ? t("stopRead.part.lead") + cp.index + "/" + cp.total + t("stopRead.part.tail", { total: cp.total })
            : t("stopRead")
          : t("readThisMessage");
        const onClick = () => {
          if (plain) speakText(plain, "manual");
        };
        const [dlErr, setDlErr] = react.useState(null);
        const dlTimer = react.useRef(null);
        const onDlError = msg => {
          setDlErr(msg);
          if (dlTimer.current) clearTimeout(dlTimer.current);
          dlTimer.current = setTimeout(() => setDlErr(null), 3500);
        };
        const onDownload = e => {
          e.stopPropagation();
          if (plain) downloadText(plain, onDlError);
        };
        const controls = isPlaying
          ? [
              ...(cp && cp.total > 1
                ? [
                    react.createElement(
                      "span",
                      {
                        className: "dsh-tts-chunk-pill",
                        "data-tts-tip": playingLabel,
                        "aria-hidden": true,
                      },
                      cp.index + "/" + cp.total,
                    ),
                  ]
                : []),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-action dsh-tts-mini-pause",
                  "aria-label": shared.paused ? t("mini.resume") : t("mini.pause"),
                  "data-tts-tip": shared.paused ? t("mini.resume") : t("mini.pause"),
                  onClick: e => {
                    e.stopPropagation();
                    togglePause();
                  },
                },
                shared.paused ? PlayIcon() : PauseIcon(),
              ),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-action dsh-tts-mini-speed",
                  "aria-label": t("mini.speed"),
                  "data-tts-tip": t("mini.speedTip"),
                  onClick: e => {
                    e.stopPropagation();
                    cycleSpeed();
                  },
                },
                react.createElement(
                  "span",
                  { className: "dsh-tts-speed-label" },
                  formatRate(shared.rate),
                ),
              ),
            ]
          : [];
        return react.createElement(
          "div",
          { className: "dsh-tts-mini" },
          ...controls,
          react.createElement(
            "button",
            {
              type: "button",
              className: "dsh-tts-action dsh-tts-action-dl",
              "aria-label": t("download.audio"),
              "data-tts-tip": t("download.audio"),
              disabled: !plain || undefined,
              onClick: onDownload,
            },
            DownloadIcon(),
          ),
          react.createElement(
            "button",
            {
              type: "button",
              className: "dsh-tts-action",
              "data-active": isPlaying || undefined,
              "aria-label": playingLabel,
              "data-tts-tip": playingLabel,
              disabled: !plain || undefined,
              onClick: onClick,
            },
            isPlaying ? EqualizerIcon() : SpeakerIcon(),
          ),
          dlErr
            ? react.createElement(
                "span",
                { className: "dsh-tts-dl-err", role: "alert" },
                dlErr,
              )
            : null,
        );
      }
      slots.inject("conversation.chat.assistant-actions", () =>
        slots.register(
          {
            name: "conversation.chat.assistant-actions",
            key: "tts-read",
            id: "tts-read",
            order: 20,
          },
          ReadAloudButton,
        ),
      );

      // ---------- 3) settings.plugins.tab: voice settings panel ----------
      const VOICES = [
        ["zh-CN-XiaoxuanNeural", t("voice.xiaoxuan")],
        ["zh-CN-XiaoyiNeural", t("voice.xiaoyi")],
        ["zh-CN-YunxiNeural", t("voice.yunxi")],
        ["zh-CN-YunyangNeural", t("voice.yunyang")],
        ["zh-CN-XiaoxiaoNeural", t("voice.xiaoxiao")],
        ["zh-CN-YunjianNeural", t("voice.yunjian")],
        ["zh-CN-YunxiaNeural", t("voice.yunxia")],
        [
          "zh-CN-liaoning-XiaobeiNeural",
          t("voice.xiaobei"),
        ],
        [
          "zh-CN-shaanxi-XiaoniNeural",
          t("voice.xiaoni"),
        ],
        ["zh-TW-HsiaoChenNeural", t("voice.hsiaochen")],
        ["zh-TW-HsiaoYuNeural", t("voice.hsiaoyu")],
        ["zh-TW-YunJheNeural", t("voice.yunjhe")],
        ["zh-HK-HiuGaaiNeural", t("voice.hiugaai")],
        ["zh-HK-HiuMaanNeural", t("voice.hiumaan")],
        ["zh-HK-WanLungNeural", t("voice.wanlung")],
        ["en-US-AriaNeural", "Aria（en-US-AriaNeural）"],
        ["en-US-JennyNeural", "Jenny（en-US-JennyNeural）"],
        ["en-US-GuyNeural", "Guy（en-US-GuyNeural）"],
        ["en-GB-SoniaNeural", "Sonia（en-GB-SoniaNeural）"],
        ["ja-JP-NanamiNeural", t("voice.nanami")],
        ["ko-KR-SunHiNeural", "SunHi（ko-KR-SunHiNeural）"],
        ["fr-FR-DeniseNeural", "Denise（fr-FR-DeniseNeural）"],
        ["ru-RU-SvetlanaNeural", t("voice.svetlana")],
        ["ru-RU-DmitryNeural", t("voice.dmitry")],
      ];

      function VoiceSettingsPanel() {
        useI18n();
        useSharedForce();
        const [lang, setLangState] = react.useState(I18N.lang);
        const changeLang = e => {
          I18N.setLang(e.target.value);
          setLangState(e.target.value);
        };
        const [voice, setVoice] = react.useState(shared.voice);
        const [preview, setPreview] =
          react.useState(t("preview.defaultText"));
        const [playingText, setPlayingText] = react.useState(null);
        const [error, setError] = react.useState(null);
        const errorTimer = react.useRef(null);
        const resetTimer = react.useRef(null);
        const isPreviewPlaying =
          shared.speaking &&
          !!playingText &&
          shared.currentText === playingText;
        react.useEffect(() => {
          if (!shared.speaking) setPlayingText(null);
        }, [shared.speaking]);
        const changeVoice = e => {
          const v = e.target.value;
          shared.voice = v;
          saveSettings();
          setVoice(v);
        };
        const [resetMsg, setResetMsg] = react.useState(null);
        const onResetSettings = () => {
          resetSettings();
          setVoice(shared.voice);
          setProvider(shared.provider);
          showError(null);
          setResetMsg(t("settings.resetDone"));
          if (resetTimer.current) clearTimeout(resetTimer.current);
          resetTimer.current = setTimeout(() => setResetMsg(null), 3000);
        };
        const showError = msg => {
          if (errorTimer.current) {
            clearTimeout(errorTimer.current);
            errorTimer.current = null;
          }
          setError(msg);
          if (msg) {
            errorTimer.current = setTimeout(() => {
              setError(null);
              errorTimer.current = null;
            }, 5000);
          }
        };
        const onPreview = () => {
          const target = plainText(preview);
          if (!target) {
            showError(t("preview.emptyError"));
            return;
          }
          if (isPreviewPlaying) {
            stopSpeaking();
            setPlayingText(null);
            return;
          }
          showError(null);
          setPlayingText(target);
          speakText(target, "manual", msg =>
            showError(t("synthFail") + msg),
          ).then(r => {
            if (r && !r.ok && r.error !== "interrupted") {
              showError(t("synthFail") + r.error);
            }
            if (r && !r.ok) setPlayingText(null);
          });
        };
        const voiceOptions = VOICES
          .filter(v => !shared.removedVoices.has(v[0]))
          .map(v =>
          react.createElement("option", { key: v[0], value: v[0] }, v[1]),
        );
        const [provider, setProvider] = react.useState(shared.provider);
        const [, setRvcTick] = react.useState(0);
        const changeProvider = e => {
          shared.provider = e.target.value;
          saveSettings();
          setProvider(e.target.value);
        };
        const setRvc = (key, value) => {
          shared.rvc[key] = value;
          saveSettings();
          setRvcTick(n => n + 1);
        };
        // ---- 文件选择器（RVC 服务文件发现）----
        const [picker, setPicker] = react.useState(null);
        // Esc closes the file picker; click on the transparent overlay also closes it
        react.useEffect(() => {
          const onKey = e => {
            if (e.key === "Escape") setPicker(null);
          };
          window.addEventListener("keydown", onKey);
          return () => window.removeEventListener("keydown", onKey);
        }, []);
        const openPicker = async kind => {
          setPicker({ kind, files: [], loading: true, error: null });
          try {
            const r = await fetch(
              "/dsh-tts-api/rvc-files?baseUrl=" +
                encodeURIComponent(shared.rvc.baseUrl) +
                "&kind=" +
                kind,
            );
            const data = await r.json().catch(() => null);
            if (!r.ok || !data || data.error) {
              throw new Error(hostErrText(data) || ("HTTP " + r.status));
            }
            setPicker({ kind, files: data.files || [], loading: false, error: null });
          } catch (e) {
            setPicker({
              kind,
              files: [],
              loading: false,
              error: t("fileListFail") + String((e && e.message) || e),
            });
          }
        };
        const pickFile = (kind, f) => {
          setRvc(kind === "pth" ? "model" : "index", f.path);
          setPicker(null);
        };
        // ---- 音色包（注册表 + 下载安装）----
        const PKG_SETTINGS_KEY = "dsh-tts-pack-settings"; // { registry, proxy }
        const PKG_ACTIVE_KEY = "dsh-tts-pack-active";      // { key, packId }
        const [registryUrl, setRegistryUrl] = react.useState("");
        const [packProxy, setPackProxy] = react.useState("");
        const [packs, setPacks] = react.useState(null); // { loading, error, list }
        const [installed, setInstalled] = react.useState({});
        const [installing, setInstalling] = react.useState(null);
        const [packNote, setPackNote] = react.useState(null);
        const [packIdx, setPackIdx] = react.useState({}); // packId -> selected index variant id
        const [installProg, setInstallProg] = react.useState(null); // { packId, pct, phase, speed }
        const [packsDir, setPacksDir] = react.useState(null);
        const savePackSettings = () => {
          try {
            localStorage.setItem(
              PKG_SETTINGS_KEY,
              JSON.stringify({ registry: registryUrl.trim(), proxy: packProxy.trim() }),
            );
          } catch (e) { /* non-fatal */ }
        };
        const refreshInstalled = async () => {
          try {
            const r = await fetch("/dsh-tts-api/rvc-packs-installed");
            const d = await r.json().catch(() => null);
            if (d && d.installed) setInstalled(d.installed);
            if (d && d.packsDir) setPacksDir(d.packsDir);
          } catch (e) { /* non-fatal */ }
        };
        // restore persisted settings + re-attach to an in-flight download
        react.useEffect(() => {
          refreshInstalled();
          try {
            const s = JSON.parse(localStorage.getItem(PKG_SETTINGS_KEY) || "null");
            if (s) {
              if (s.registry) setRegistryUrl(s.registry);
              if (s.proxy) setPackProxy(s.proxy);
            }
          } catch (e) { /* non-fatal */ }
          try {
            const a = JSON.parse(localStorage.getItem(PKG_ACTIVE_KEY) || "null");
            if (a && a.key && a.packId) restoreActiveInstall(a.key, a.packId);
            else localStorage.removeItem(PKG_ACTIVE_KEY);
          } catch (e) { /* non-fatal */ }
        }, []);
        // re-attach to a download started before the panel was closed
        const restoreActiveInstall = (key, packId) => {
          let waitingCount = 0;
          const poll = async () => {
            for (let i = 0; i < 120; i++) {
              await new Promise(res => setTimeout(res, 500));
              try {
                const pr = await fetch("/dsh-tts-api/rvc-pack-progress?key=" + encodeURIComponent(key));
                const d = await pr.json().catch(() => null);
                if (d && d.finished) {
                  setInstalling(null);
                  setInstallProg(null);
                  localStorage.removeItem(PKG_ACTIVE_KEY);
                  refreshInstalled();
                  return;
                }
                if (d && d.waiting !== true && d.total) {
                  waitingCount = 0;
                  setInstalling(packId);
                  setInstallProg({
                    packId,
                    pct: Math.min(100, Math.round((d.done / d.total) * 100)),
                    phase: (d.phaseKey && t("host.phase." + d.phaseKey) !== "host.phase." + d.phaseKey)
                      ? t("host.phase." + d.phaseKey)
                      : (d.phase === t("tab.index") ? t("tab.index") : t("tab.model")),
                    speed: d.speed || 0,
                  });
                  continue;
                }
                // no entry yet — either still preparing or already gone
                waitingCount++;
                if (waitingCount > 4) {
                  // give up: entry expired without a finish flag
                  localStorage.removeItem(PKG_ACTIVE_KEY);
                  setInstalling(null);
                  setInstallProg(null);
                  refreshInstalled();
                  return;
                }
                setInstalling(packId);
                setInstallProg({ packId, pct: 0, phase: t("busy.preparing"), speed: 0 });
              } catch (e) { /* transient */ }
            }
          };
          poll();
        };
        const fetchPacks = async () => {
          const reg = registryUrl.trim();
          if (!reg) {
            setPacks({ loading: false, error: t("packs.needUrl"), list: [] });
            return;
          }
          savePackSettings();
          setPacks({ loading: true, error: null, list: [] });
          try {
            const r = await fetch(
              "/dsh-tts-api/rvc-packs?registry=" +
                encodeURIComponent(reg) +
                (packProxy.trim() ? "&proxy=" + encodeURIComponent(packProxy.trim()) : ""),
            );
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || d.error) {
              throw new Error(hostErrText(d) || ("HTTP " + r.status));
            }
            setPacks({ loading: false, error: null, list: d.packs || [] });
            refreshInstalled(); // reconcile installed state (files may have been removed)
          } catch (e) {
            setPacks({
              loading: false,
              error: t("packs.listFail") + String((e && e.message) || e),
              list: [],
            });
          }
        };
        const installPack = async (pack, indexId) => {
          const progressKey = pack.id + "-" + Date.now();
          try {
            localStorage.setItem(PKG_ACTIVE_KEY, JSON.stringify({ key: progressKey, packId: pack.id }));
          } catch (e) { /* non-fatal */ }
          setInstalling(pack.id);
          setPackNote(null);
          setInstallProg({ packId: pack.id, pct: 0, phase: t("packs.waitingStart"), speed: 0 });
          const fmtSpeed = bps =>
            bps >= 1048576
              ? (bps / 1048576).toFixed(1) + " MB/s"
              : Math.round(bps / 1024) + " KB/s";
          let settled = false;
          const req = fetch("/dsh-tts-api/rvc-pack-install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registry: registryUrl.trim(),
              packId: pack.id,
              indexId: indexId || "",
              progressKey: progressKey,
              proxy: packProxy.trim(),
            }),
          })
            .then(r => r.json().catch(() => null))
            .catch(e => ({ error: String((e && e.message) || e) }));
          const poll = (async () => {
            const pollStart = Date.now();
            while (!settled) {
              await new Promise(res => setTimeout(res, 250));
              if (settled) break;
              if (Date.now() - pollStart > 720000) break; // safety cap (12 min)
              try {
                const pr = await fetch(
                  "/dsh-tts-api/rvc-pack-progress?key=" + encodeURIComponent(progressKey),
                );
                const d = await pr.json().catch(() => null);
                if (!d || d.waiting) {
                  // install not reporting yet (manifest fetch etc.) — keep polling
                  setInstallProg(p =>
                    p && p.packId === pack.id ? { ...p, pct: 0, phase: t("busy.preparing"), speed: 0 } : p,
                  );
                  continue;
                }
                const finished = !!d.finished;
                const pct = d.total
                  ? Math.min(100, Math.round((d.done / d.total) * 100))
                  : 0;
                setInstallProg({
                  packId: pack.id,
                  pct: finished ? 100 : pct,
                  phase: finished ? t("packs.done")
                    : (d.phaseKey && t("host.phase." + d.phaseKey) !== "host.phase." + d.phaseKey)
                      ? t("host.phase." + d.phaseKey)
                      : (d.phase === t("tab.index") ? t("tab.index") : t("tab.model")),
                  speed: d.speed || 0,
                });
              } catch (e) { /* transient poll error — keep trying */ }
            }
          })();
          const d = await req;
          settled = true;
          if (d && !d.error && d.ok !== false) {
            setRvc("model", d.modelPath);
            if (d.indexPath) setRvc("index", d.indexPath);
            if (pack.baseVoice) setRvc("baseVoice", pack.baseVoice);
            if (typeof pack.indexRate === "number") setRvc("indexRate", pack.indexRate);
            if (pack.f0Method) setRvc("f0Method", pack.f0Method);
            setPackNote({
              ok: true,
              text: t("packs.installedEnabled") + (d.name || pack.id) + "」" + (d.skipped ? t("packs.alreadyLatest") : ""),
            });
            refreshInstalled();
          } else {
            setPackNote({
              ok: false,
              text: t("packs.installFail") + hostErrText(d) || t("packs.unknownError"),
            });
          }
          setInstallProg(null);
          setInstalling(null);
          try {
            localStorage.removeItem(PKG_ACTIVE_KEY);
          } catch (e) { /* non-fatal */ }
        };
        const uninstallPack = async pack => {
          if (!window.confirm(t("packs.confirmUninstall.lead") + (pack.name || pack.id) + t("packs.confirmUninstall.tail"))) return;
          setPackNote(null);
          try {
            const r = await fetch("/dsh-tts-api/rvc-pack-uninstall", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ packId: pack.id }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || d.error) throw new Error(hostErrText(d) || ("HTTP " + r.status));
            // clear the rvc paths if they pointed into the removed pack dir
            const inst = installed[pack.id];
            if (inst) {
              if (shared.rvc.model && inst.modelPath && shared.rvc.model === inst.modelPath) setRvc("model", "");
              if (shared.rvc.index && inst.indexPath && shared.rvc.index === inst.indexPath) setRvc("index", "");
            }
            setPackNote({ ok: true, text: t("packs.uninstalled") + (pack.name || pack.id) + "」" });
            refreshInstalled();
          } catch (e) {
            setPackNote({ ok: false, text: t("packs.uninstallFail") + String((e && e.message) || e) });
          }
        };
        // ---- 一键诊断（Edge 合成 / RVC 服务）----
        const [diag, setDiag] = react.useState(null); // { running, checks, error }
        const runDiagnose = async () => {
          setDiag({ running: true, checks: null, error: null });
          try {
            const r = await fetch("/dsh-tts-api/diagnose", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rvcBaseUrl: shared.rvc.baseUrl }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || d.error) {
              if (d && d.error) throw new Error(hostErrText(d));
              if (r.status === 405 || r.status === 404)
                throw new Error(t("diag.httpUnavailable") + r.status + t("diag.httpUnavailable.tail"));
              throw new Error(t("diag.httpFail") + r.status + t("diag.httpFail.tail"));
            }
            setDiag({ running: false, checks: d.checks || [], error: null });
          } catch (e) {
            setDiag({ running: false, checks: null, error: String((e && e.message) || e) });
          }
        };
        const diagMark = c =>
          c.ok ? react.createElement("span", { className: "dsh-tts-diag-ok" }, "✓")
            : c.cls === "warn"
              ? react.createElement("span", { className: "dsh-tts-diag-warn" }, "!")
              : react.createElement("span", { className: "dsh-tts-diag-fail" }, "✗");
        const diagRow = c =>
          react.createElement(
            "div",
            { className: "dsh-tts-diag-row" },
            react.createElement("span", { className: "dsh-tts-diag-mark" }, diagMark(c)),
            react.createElement("span", { className: "dsh-tts-diag-name" }, c.name),
            react.createElement(
              "span",
              {
                className:
                  "dsh-tts-diag-detail " +
                  (c.ok ? "dsh-tts-diag-ok" : c.cls === "warn" ? "dsh-tts-diag-warn" : "dsh-tts-diag-fail"),
              },
              c.detail || "",
            ),
          );
        const diagModule = () =>
          react.createElement(
            "div",
            { className: "dsh-tts-module dsh-tts-module-stack" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                t("diag.title"),
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                t("diag.desc"),
              ),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-preview-row" },
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  onClick: runDiagnose,
                  disabled: !!diag && diag.running,
                },
                diag && diag.running ? t("diag.running") : t("diag.run"),
              ),
            ),
            diag && diag.checks
              ? react.createElement("div", { className: "dsh-tts-diag" }, diag.checks.map(diagRow))
              : null,
            diag && diag.error
              ? react.createElement("div", { className: "dsh-tts-error" }, t("diag.fail") + diag.error)
              : null,
          );
        const packSection = () =>
          react.createElement(
            "div",
            { className: "dsh-tts-module dsh-tts-module-stack dsh-tts-rvc" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                t("packs.title"),
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                t("packs.desc"),
              ),
              packsDir
                ? react.createElement(
                    "div",
                    { className: "dsh-tts-compact-info" },
                    t("packs.installTo") + packsDir + t("packs.installTo.tail"),
                  )
                : null,
            ),
            field(
              t("packs.registryUrl"),
              react.createElement(
                "div",
                { className: "dsh-tts-path" },
                react.createElement("input", {
                  className: "dsh-tts-rvc-input",
                  value: registryUrl,
                  placeholder: "https://example.com/tts-packs",
                  onChange: e => {
                    setRegistryUrl(e.target.value);
                    savePackSettings();
                  },
                }),
                react.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-tts-browse",
                    onClick: fetchPacks,
                    disabled: !!packs && packs.loading,
                  },
                  packs && packs.loading ? t("packs.loading") : t("packs.fetchList"),
                ),
              ),
              t("packs.registryHelp"),
            ),
            field(
              t("packs.proxy"),
              react.createElement("input", {
                className: "dsh-tts-rvc-input",
                value: packProxy,
                placeholder: t("packs.proxyPlaceholder"),
                onChange: e => {
                  setPackProxy(e.target.value);
                  savePackSettings();
                },
              }),
              t("packs.proxyHelp"),
            ),
            packs && packs.loading
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-compact-info" },
                  t("packs.fetching"),
                )
              : null,
            packs && packs.error
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-error" },
                  packs.error,
                )
              : null,
            packs && packs.list.length
              ? packs.list.map(p =>
                  react.createElement(
                    "div",
                    { key: p.id, className: "dsh-tts-pack-card" },
                    react.createElement(
                      "div",
                      { className: "dsh-tts-pack-head" },
                      react.createElement(
                        "span",
                        { className: "dsh-tts-pack-name" },
                        p.name || p.id,
                      ),
                      installed[p.id]
                        ? react.createElement(
                            "div",
                            { className: "dsh-tts-pack-head-actions" },
                            react.createElement(
                              "button",
                              {
                                type: "button",
                                className: "dsh-tts-pack-btn",
                                "data-done": true,
                                disabled: true,
                              },
                              t("packs.installedV") + (installed[p.id].version || ""),
                            ),
                            react.createElement(
                              "button",
                              {
                                type: "button",
                                className: "dsh-tts-pack-btn dsh-tts-pack-uninstall",
                                onClick: () => uninstallPack(p),
                              },
                              t("packs.uninstall"),
                            ),
                          )
                        : installing === p.id && installProg && installProg.packId === p.id
                          ? react.createElement(
                              "div",
                              { className: "dsh-tts-pack-progress" },
                              react.createElement(
                                "div",
                                { className: "dsh-tts-pack-progress-bar" },
                                react.createElement("div", {
                                  className: "dsh-tts-pack-progress-fill",
                                  style: { width: (installProg.pct || 0) + "%" },
                                }),
                              ),
                              react.createElement(
                                "span",
                                { className: "dsh-tts-pack-progress-text" },
                                installProg.phase +
                                  " " +
                                  (installProg.pct || 0) +
                                  "%" +
                                  (installProg.speed
                                    ? " · " +
                                      (installProg.speed >= 1048576
                                        ? (installProg.speed / 1048576).toFixed(1) + " MB/s"
                                        : Math.round(installProg.speed / 1024) + " KB/s")
                                    : ""),
                              ),
                            )
                          : react.createElement(
                              "button",
                              {
                                type: "button",
                                className: "dsh-tts-pack-btn",
                                disabled: installing === p.id,
                                onClick: () =>
                                  installPack(
                                    p,
                                    (Array.isArray(p.indexes) && p.indexes.length && packIdx[p.id]) ||
                                      (Array.isArray(p.indexes) && p.indexes.length ? p.indexes[0].id : ""),
                                  ),
                              },
                              installing === p.id ? t("packs.downloading") : t("packs.downloadEnable"),
                            ),
                    ),
                    Array.isArray(p.indexes) && p.indexes.length > 1
                      ? react.createElement(
                          "div",
                          { className: "dsh-tts-compact-row", style: { marginTop: 6 } },
                          react.createElement(
                            "span",
                            { className: "dsh-tts-compact-src" },
                            t("packs.indexVersion"),
                          ),
                          react.createElement(
                            "select",
                            {
                              className: "dsh-tts-compact-select",
                              value: packIdx[p.id] || p.indexes[0].id,
                              disabled: installing === p.id,
                              onChange: e => setPackIdx(s => ({ ...s, [p.id]: e.target.value })),
                            },
                            p.indexes.map(i =>
                              react.createElement("option", { key: i.id, value: i.id }, i.name || i.id),
                            ),
                          ),
                        )
                      : null,
                    react.createElement(
                      "div",
                      { className: "dsh-tts-pack-meta" },
                      (p.description || "") +
                        t("packs.modelSep") +
                        fmtMb(p.model && p.model.size) +
                        (Array.isArray(p.indexes) && p.indexes.length
                          ? t("packs.plusIdx") +
                            p.indexes.length +
                            t("packs.count") +
                            p.indexes.map(i => fmtMb(i.size)).join("/") +
                            "）"
                          : p.index && p.index.size
                            ? t("packs.plusIndex") + fmtMb(p.index.size)
                            : t("packs.noIndex")) +
                        t("packs.licenseSep") +
                        (p.license || t("packs.unknown")) +
                        (p.author ? t("packs.authorSep") + p.author : ""),
                    ),
                  ),
                )
              : null,
            packNote
              ? react.createElement(
                  "div",
                  {
                    className: packNote.ok ? "dsh-tts-compact-info dsh-tts-compact-ok" : "dsh-tts-error",
                  },
                  packNote.text,
                )
              : null,
            react.createElement(
              "div",
              { className: "dsh-tts-footnote" },
              t("packs.copyright"),
            ),
          );
        // ---- 紧凑索引生成器 ----
        const [compact, setCompact] = react.useState(null);
        const COMPACT_TARGETS = [
          [2000, t("compact.size2k")],
          [5000, t("compact.size5k")],
          [10000, t("compact.size10k")],
          [20000, t("compact.size20k")],
        ];
        const runCompact = async () => {
          if (!shared.rvc.index) {
            setCompact(c => ({ ...c, error: t("compact.needIndex") }));
            return;
          }
          setCompact(c => ({ ...c, busy: true, error: null, result: null }));
          try {
            const r = await fetch("/dsh-tts-api/rvc-compact-index", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baseUrl: shared.rvc.baseUrl,
                index: shared.rvc.index,
                target_vectors: compact.target,
              }),
            });
            const data = await r.json().catch(() => null);
            if (!r.ok || !data || data.error) {
              throw new Error(hostErrText(data) || ("HTTP " + r.status));
            }
            if (data.already_small) {
              setCompact(c => ({
                ...c,
                busy: false,
                error: null,
                result: { alreadySmall: true, size: data.size, vectors: data.vectors },
              }));
              return;
            }
            setRvc("index", data.path); // 生成成功自动填入索引路径
            setCompact(c => ({
              ...c,
              busy: false,
              error: null,
              result: data,
            }));
          } catch (e) {
            setCompact(c => ({
              ...c,
              busy: false,
              error: t("compact.fail") + String((e && e.message) || e),
            }));
          }
        };
        const compactPanel = () => {
          if (!compact || !compact.open) return null;
          const fmtMb = n => ((n || 0) / 1048576).toFixed(1) + " MB";
          const srcName = shared.rvc.index
            ? shared.rvc.index.split(/[\\/]/).pop()
            : t("compact.noIndex");
          return react.createElement(
            "div",
            { className: "dsh-tts-compact" },
            react.createElement(
              "div",
              { className: "dsh-tts-picker-title" },
              t("compact.desc"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-compact-src" },
              t("compact.source") + srcName,
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-compact-row" },
              react.createElement(
                "select",
                {
                  className: "dsh-tts-compact-select",
                  value: compact.target,
                  disabled: !!compact.busy,
                  onChange: e => setCompact(c => ({ ...c, target: Number(e.target.value) })),
                },
                COMPACT_TARGETS.map(t =>
                  react.createElement("option", { key: t[0], value: t[0] }, t[1]),
                ),
              ),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-compact-btn",
                  disabled: !!compact.busy,
                  onClick: runCompact,
                },
                compact.busy ? t("compact.building") : t("compact.generate"),
              ),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-compact-btn",
                  disabled: !!compact.busy,
                  onClick: () => setCompact(null),
                },
                t("compact.close"),
              ),
            ),
            compact.busy
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-compact-info" },
                  t("compact.reading"),
                )
              : null,
            compact.error
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-error" },
                  compact.error,
                )
              : null,
            compact.result
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-compact-info dsh-tts-compact-ok" },
                  compact.result.alreadySmall
                    ? t("compact.alreadySmall.lead") + fmtMb(compact.result.size) + t("compact.alreadySmall.tail")
                    : t("compact.generated") +
                      compact.result.path.split(/[\\/]/).pop() +
                      "（" +
                      fmtMb(compact.result.size) +
                      t("compact.orig") +
                      fmtMb(compact.result.source_size) +
                      "，-" +
                      compact.result.reduction_pct +
                      t("compact.autoFill"),
                )
              : null,
          );
        };
        const pickerList = kind => {
          const p = picker;
          if (!p || p.kind !== kind) return null;
          if (p.loading)
            return react.createElement(
              "div",
              { className: "dsh-tts-picker" },
              t("picker.readingFiles"),
            );
          if (p.error)
            return react.createElement(
              "div",
              { className: "dsh-tts-picker dsh-tts-error" },
              p.error,
            );
          return react.createElement(
            "div",
            { className: "dsh-tts-picker" },
            react.createElement(
              "div",
              { className: "dsh-tts-picker-title" },
              p.files.length
                ? t("picker.found") + p.files.length + t("picker.foundTail")
                : t("picker.none"),
            ),
            p.files.map(f =>
              react.createElement(
                "button",
                {
                  key: f.path,
                  type: "button",
                  className: "dsh-tts-picker-item",
                  onClick: () => pickFile(kind, f),
                },
                react.createElement(
                  "span",
                  { className: "dsh-tts-picker-name" },
                  f.name,
                ),
                react.createElement(
                  "span",
                  { className: "dsh-tts-picker-size" },
                  (f.size / 1048576).toFixed(1) + " MB",
                ),
              ),
            ),
          );
        };
        const onUploadAudio = e => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const b64 = String(reader.result || "").split(",")[1] || "";
            setRvc("baseAudioData", b64);
            setRvc("baseAudioName", file.name);
          };
          reader.readAsDataURL(file);
        };
        const field = (label, control, note) =>
          react.createElement(
            "div",
            { className: "dsh-tts-field" },
            react.createElement(
              "div",
              { className: "dsh-tts-rvc-row" },
              react.createElement(
                "span",
                { className: "dsh-tts-rvc-label" },
                label,
              ),
              control,
            ),
            note
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-note" },
                  note,
                )
              : null,
          );
        const textIn = (key, placeholder) =>
          react.createElement("input", {
            className: "dsh-tts-rvc-input",
            value: shared.rvc[key],
            placeholder: placeholder,
            onChange: e => setRvc(key, e.target.value),
          });
        const num = (key, step, min) =>
          react.createElement("input", {
            className: "dsh-tts-rvc-input dsh-tts-rvc-input-num",
            type: "number",
            step: step,
            min: min,
            value: shared.rvc[key],
            onChange: e => setRvc(key, Number(e.target.value)),
          });
        const sel = (key, options) =>
          react.createElement(
            "select",
            {
              className: "dsh-tts-rvc-input dsh-tts-select",
              value: shared.rvc[key],
              onChange: e => setRvc(key, e.target.value),
            },
            options.map(o =>
              react.createElement("option", { key: o[0], value: o[0] }, o[1]),
            ),
          );
        const selNum = (key, options) =>
          react.createElement(
            "select",
            {
              className: "dsh-tts-rvc-input dsh-tts-select",
              value: shared.rvc[key],
              onChange: e => setRvc(key, Number(e.target.value)),
            },
            options.map(o =>
              react.createElement("option", { key: o[0], value: o[0] }, o[1]),
            ),
          );
        const slider = (key, min, max, step, fmt) =>
          react.createElement(
            "div",
            { className: "dsh-tts-slider" },
            react.createElement("input", {
              type: "range",
              min: min,
              max: max,
              step: step,
              value: shared.rvc[key],
              onChange: e => setRvc(key, Number(e.target.value)),
            }),
            react.createElement(
              "div",
              { className: "dsh-tts-slider-scale" },
              react.createElement(
                "span",
                { className: "dsh-tts-slider-end" },
                fmt(min),
              ),
              react.createElement("span", { className: "dsh-tts-slider-spacer" }),
              react.createElement(
                "span",
                { className: "dsh-tts-slider-end" },
                fmt(max),
              ),
              react.createElement(
                "span",
                { className: "dsh-tts-slider-value" },
                fmt(shared.rvc[key]),
              ),
            ),
          );
        const pctFmt = v => Math.round(v * 100) + "%";
        const pct100Fmt = v =>
          v === 0 ? t("f0.default") : (v > 0 ? "+" : "") + v + "%";
        const semiFmt = v => (v > 0 ? "+" : "") + v + t("f0.semitones");
        const fmtMb = n =>
          n ? (n / 1048576 >= 100 ? (n / 1048576 / 1024).toFixed(1) + " GB" : (n / 1048576).toFixed(1) + " MB") : "0 MB";
        const BASE_VOICES = [
          ["zh-CN-YunyangNeural", t("baseVoice.yunyang")],
          ["zh-CN-YunxiNeural", t("baseVoice.yunxi")],
          ["zh-CN-YunxiaNeural", t("baseVoice.yunxia")],
          ["zh-CN-XiaoxiaoNeural", t("baseVoice.xiaoxiao")],
          ["zh-CN-XiaoyiNeural", t("baseVoice.xiaoyi")],
          ["en-US-GuyNeural", t("baseVoice.guy")],
          ["en-US-JennyNeural", t("baseVoice.jenny")],
        ];
        const F0_OPTIONS = [
          ["rmvpe", t("f0.rmvpe")],
          ["pm", t("f0.pm")],
          ["harvest", t("f0.harvest")],
          ["crepe", t("f0.crepe")],
        ];
        const SR_OPTIONS = [
          [16000, "16 kHz"],
          [24000, "24 kHz"],
          [32000, "32 kHz"],
          [40000, "40 kHz"],
          [48000, "48 kHz"],
        ];

        // 声音调节 —— Edge TTS 属性，两种 provider 通用
        const soundSection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              t("section.voiceTuning"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              provider === "rvc"
                ? t("voiceTuning.desc")
                : t("voiceTuning.edgeDesc"),
            ),
          ),
          field(
            t("field.rate"),
            slider("baseRate", -50, 50, 1, pct100Fmt),
            t("field.rate.tip"),
          ),
          field(
            t("field.pitch"),
            slider("basePitch", -50, 50, 1, pct100Fmt),
            t("field.pitch.tip"),
          ),
          field(
            t("field.volume"),
            slider("baseVolume", -50, 50, 1, pct100Fmt),
            t("field.volume.tip"),
          ),
        );

        const rvcSection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack dsh-tts-rvc" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              t("section.rvc"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              t("rvc.desc"),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-onboard" },
            react.createElement(
              "div",
              { className: "dsh-tts-onboard-title" },
              t("onboard.title"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-onboard-desc" },
              t("onboard.desc"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-onboard-steps" },
              t("onboard.steps"),
            ),
            react.createElement(
              "pre",
              { className: "dsh-tts-onboard-cmd" },
              t("onboard.cmd"),
            ),
            react.createElement(
              "button",
              {
                type: "button",
                className: "dsh-tts-browse",
                onClick: runDiagnose,
                disabled: (diag && diag.running) || undefined,
              },
              t("diag.run"),
            ),
          ),
          field(
            t("field.baseUrl"),
            textIn("baseUrl", "http://127.0.0.1:4892"),
            t("field.baseUrl.tip"),
          ),
          field(
            t("field.baseSource"),
            sel("baseSource", [
              ["edge", t("baseSource.edge")],
              ["upload", t("baseSource.upload")],
            ]),
            t("baseSource.tip"),
          ),
          shared.rvc.baseSource === "upload"
            ? field(
                t("baseSource.uploadBtn"),
                react.createElement(
                  "div",
                  { className: "dsh-tts-upload" },
                  react.createElement(
                    "label",
                    { className: "dsh-tts-file-btn" },
                    t("baseSource.chooseFile"),
                    react.createElement("input", {
                      type: "file",
                      accept: ".wav,.mp3,.m4a,.ogg,.flac,audio/*",
                      style: { display: "none" },
                      onChange: onUploadAudio,
                    }),
                  ),
                  react.createElement(
                    "span",
                    { className: "dsh-tts-upload-name" },
                    shared.rvc.baseAudioName || t("baseSource.noFile"),
                  ),
                ),
                t("baseSource.uploadTip"),
              )
            : null,
          shared.rvc.baseSource === "edge"
            ? field(
                t("field.baseVoice"),
                sel("baseVoice", BASE_VOICES),
                t("field.baseVoice.tip"),
              )
            : null,
          field(
            t("field.modelPath"),
            react.createElement(
              "div",
              { className: "dsh-tts-path" },
              textIn("model", "E:\\...\\assets\\weights\\xxx.pth"),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  onClick: () => openPicker("pth"),
                },
                t("field.browse"),
              ),
            ),
            picker && picker.kind === "pth"
              ? pickerList("pth")
              : t("field.modelPath.tip"),
          ),
          field(
            t("field.indexPath"),
            react.createElement(
              "div",
              { className: "dsh-tts-path" },
              textIn("index", t("indexPath.empty")),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  onClick: () => openPicker("index"),
                },
                t("field.browse"),
              ),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  title: t("indexPath.compactTip"),
                  onClick: () =>
                    setCompact({ open: true, busy: false, error: null, result: null, target: 10000 }),
                },
                t("indexPath.compact"),
              ),
            ),
            react.createElement(
              react.Fragment,
              null,
              picker && picker.kind === "index"
                ? pickerList("index")
                : t("indexPath.tip"),
              compactPanel(),
            ),
          ),
          react.createElement(
            "details",
            { className: "dsh-tts-advanced" },
            react.createElement("summary", null, t("section.advanced")),
            field(
              t("field.spkId"),
              num("spkId", 1, 0),
              t("field.spkId.tip"),
            ),
            field(
              t("field.f0Method"),
              sel("f0Method", F0_OPTIONS),
              t("field.f0Method.tip"),
            ),
            field(
              t("field.f0UpKey"),
              slider("f0UpKey", -12, 12, 1, semiFmt),
              t("field.f0UpKey.tip"),
            ),
            field(
              t("field.indexRate"),
              slider("indexRate", 0, 1, 0.05, pctFmt),
              t("field.indexRate.tip"),
            ),
            field(
              t("field.resampleSr"),
              selNum("resampleSr", SR_OPTIONS),
              t("field.resampleSr.tip"),
            ),
            field(
              t("field.rmsMixRate"),
              slider("rmsMixRate", 0, 1, 0.05, pctFmt),
              t("field.rmsMixRate.tip"),
            ),
            field(
              t("field.protect"),
              slider("protect", 0, 1, 0.05, pctFmt),
              t("field.protect.tip"),
            ),
            field(
              t("field.filterRadius"),
              slider("filterRadius", 0, 7, 1, v => String(v)),
              t("field.filterRadius.tip"),
            ),
            field(
              t("field.f0File"),
              textIn("f0File", t("f0File.empty")),
              t("f0File.tip"),
            ),
          ),
        );
        return react.createElement(
          "div",
          { className: "dsh-tts-settings" },
          react.createElement(
            "div",
            { className: "dsh-tts-module" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                t("lang.label"),
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                I18N.lang === "auto" ? t("lang.modeAuto") : t("lang.modeManual"),
              ),
            ),
            react.createElement(
              "select",
              {
                className: "dsh-tts-select",
                value: lang,
                onChange: changeLang,
              },
              react.createElement("option", { value: "auto" }, t("lang.auto")),
              react.createElement("option", { value: "zh" }, t("lang.zh")),
              react.createElement("option", { value: "en" }, t("lang.en")),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-module" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                t("provider.label"),
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                t("provider.help"),
              ),
            ),
            react.createElement(
              "select",
              {
                className: "dsh-tts-select",
                value: provider,
                onChange: changeProvider,
              },
              react.createElement(
                "option",
                { value: "edge-tts" },
                "Edge TTS",
              ),
              react.createElement(
                "option",
                { value: "rvc" },
                t("provider.rvc"),
              ),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-module dsh-tts-reset" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                t("settings.reset"),
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                resetMsg || " ",
              ),
            ),
            react.createElement(
              "button",
              {
                type: "button",
                className: "dsh-tts-browse",
                onClick: onResetSettings,
              },
              t("settings.reset"),
            ),
          ),
          provider !== "rvc"
            ? react.createElement(
                "div",
                { className: "dsh-tts-module" },
                react.createElement(
                  "div",
                  { className: "dsh-tts-module-info" },
                  react.createElement(
                    "div",
                    { className: "dsh-tts-module-title" },
                    t("field.voice"),
                  ),
                  react.createElement(
                    "div",
                    { className: "dsh-tts-module-desc" },
                    t("field.voice.tip"),
                  ),
                ),
                react.createElement(
                  "select",
                  {
                    className: "dsh-tts-select",
                    value: voice,
                    onChange: changeVoice,
                  },
                  voiceOptions,
                ),
              )
            : null,
          provider !== "rvc" || shared.rvc.baseSource === "edge"
            ? soundSection
            : null,
          provider === "rvc" ? rvcSection : null,
          provider === "rvc" ? packSection() : null,
          diagModule(),
          react.createElement(
            "div",
            { className: "dsh-tts-module dsh-tts-module-stack" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                t("preview.title"),
              ),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-preview-row" },
              react.createElement("input", {
                className: "dsh-tts-preview-input",
                value: preview,
                "aria-label": t("preview.text"),
                onChange: e => setPreview(e.target.value),
              }),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-preview-btn",
                  "aria-label": isPreviewPlaying ? t("preview.stop") : t("preview.play"),
                  title: isPreviewPlaying ? t("preview.playing") : t("preview.play"),
                  onClick: onPreview,
                },
                isPreviewPlaying ? SpinnerIcon() : PlayIcon(),
              ),
            ),
            error
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-error", role: "status" },
                  error,
                )
              : null,
            isPreviewPlaying && shared.chunkProgress && shared.chunkProgress.total > 1
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-status", role: "status" },
                  t("chunk.playing.lead") +
                    shared.chunkProgress.index +
                    "/" +
                    shared.chunkProgress.total +
                    t("chunk.playing.tail"),
                )
              : null,
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-footnote" },
            t("footnote"),
          ),
          picker
            ? react.createElement("div", {
                className: "dsh-tts-overlay",
                onClick: () => setPicker(null),
              })
            : null,
        );
      }
      slots.inject("settings.plugins.tab", () =>
        slots.register(
          {
            name: "settings.plugins.tab",
            key: "tts",
            id: "tts",
            order: 20,
            label: () => t("tab.voice"),
          },
          VoiceSettingsPanel,
        ),
      );
    };

    exports.apply = apply;
    return module.exports;
  },
});
