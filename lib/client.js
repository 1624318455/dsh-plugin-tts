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

    // Service dependencies (fiber inject waiting): the client runner creates
    // the entry as ctx.plugin({ inject, apply }), so apply only runs after
    // `slots` is available. Without this declaration, ctx.get("slots") can be
    // undefined at apply time and the whole UI silently no-ops (no read-aloud
    // buttons, no auto-read toggle, no voice settings tab).
    const inject = ["slots"];

    // Bundle build tag: bump on every client fix so a console line proves
    // WHICH code is actually running (rules out stale-bundle confusion).
    const CLIENT_BUILD = "2026-09-20.11-follow-climbdiag";
    const apply = ctx => {
      const slots = ctx.slots ?? (typeof ctx.get === "function" ? ctx.get("slots") : undefined);
      if (!slots) throw new Error("[dsh-plugin-tts] slots service unavailable");
      try {
        console.info("[tts] client build " + CLIENT_BUILD + " loaded");
      } catch (e) {}

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
            "emptyText": "暂无可朗读的文本",
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
            "diag.desc": "一键检查：Edge TTS 在线合成、本地 RVC 服务与模型、本地 Index-TTS2 服务与参考音色",
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
            "provider.help": "Edge TTS：免费在线音色，开箱即用；自定义音色（RVC）：用你自己训练的模型，需先启动转换服务；本地音色（Index-TTS2）：用本机 index-tts2-nvidia 包的参考音频音色，需先双击「启动api服务.bat」",
            "provider.rvc": "自定义音色（RVC）",
            "provider.index": "本地音色（Index-TTS2）",
            "section.index": "Index-TTS2 配置",
            "index.desc": "连接本机 index-tts2-nvidia 包的 API 服务（默认 http://127.0.0.1:7880），用参考音频的音色朗读。先双击本地包里的「启动api服务.bat」（保持窗口运行），再点「刷新音色」选音色试听",
            "index.onboard.title": "首次使用 Index-TTS2？三步上手",
            "index.onboard.desc": "用本地参考音频音色朗读需要：① 本机正在运行的 API 服务；② api/ckyp 目录里有参考音频。",
            "index.onboard.steps": "① 双击本地包里的「启动api服务.bat」（保持窗口运行，默认 7880 端口）；\n② 在下方点「刷新音色」，确认能看到参考音频列表；\n③ 选一个参考音色，点「一键诊断」确认服务在线。",
            "index.field.baseUrl": "服务地址",
            "index.field.baseUrl.tip": "一般保持默认：本地 Index-TTS2 API 服务的地址（默认 7880 端口）",
            "index.field.voice": "参考音色",
            "index.field.voice.tip": "决定朗读是谁的声音：来自本地包 api/ckyp 目录的参考音频；点「刷新音色」同步最新列表，也可直接粘贴文件名或上传新音频",
            "index.refresh": "刷新音色",
            "index.refreshing": "刷新中…",
            "index.voices.none": "暂无参考音色：请往本地包 api/ckyp 目录放 wav/mp3，或用下方上传",
            "index.voices.fail": "音色列表读取失败：",
            "index.upload": "上传参考音频",
            "index.uploading": "上传中…",
            "index.upload.ok": "已上传：",
            "index.upload.fail": "上传失败：",
            "index.upload.tip": "支持 wav/mp3/flac/m4a/ogg，会自动存入本地包 api/ckyp 并可直接选用",
            "index.cleanText": "朗读前清洗文本",
            "index.cleanText.tip": "去掉 Markdown/链接/HTML 等符号再合成（阅读类场景建议开启）",
            "index.emo.method": "情感控制",
            "index.emo.method.tip": "0=跟随参考音频；1=用另一段情感参考音频；2=情感向量（高级）；3=用文字描述情感",
            "index.emo.0": "跟随参考音频",
            "index.emo.1": "情感参考音频",
            "index.emo.2": "情感向量（高级）",
            "index.emo.3": "情感文本描述",
            "index.emo.weight": "情感强度",
            "index.emo.weight.tip": "情感参考的影响强度（越大越夸张）",
            "index.emo.ref": "情感参考音频",
            "index.emo.ref.tip": "情感控制选「情感参考音频」时生效：用另一段音频的情绪来读",
            "index.emo.text": "情感描述文本",
            "index.emo.text.tip": "情感控制选「情感文本描述」时生效，如：开心地朗读",
            "index.emo.random": "随机情感",
            "index.emo.random.tip": "每次合成随机一点情感变化（拟人感更强，但不稳定）",
            "index.field.maxSeg": "单段最大文本",
            "index.field.maxSeg.tip": "长文本按语义切段合成：每段最多文本 token 数（越大越连贯、越小越稳）",
            "index.field.temperature": "随机性",
            "index.field.temperature.tip": "越大越发散、越小越稳定（0.8 为默认）",
            "index.field.topP": "Top-P",
            "index.field.topP.tip": "采样截断：越小越保守（0.8 为默认）",
            "field.voice": "朗读音色",
            "field.voice.tip": "选择朗读用的声音（仅 Edge TTS 模式可选）",
            "preview.title": "试听测试",
            "preview.text": "试听文本",
            "preview.stop": "停止试听",
            "preview.play": "试听",
            "preview.playing": "停止试听（播放中）",
            "chunk.playing.lead": "正在播放 第 ",
            "chunk.playing.tail": " 段 · 后续段落边播边合成…",
            "overlay.reading": "朗读中",
            "overlay.paused": "已暂停",
            "overlay.showToggle": "显示全局朗读中按钮",
            "overlay.showToggle.desc": "屏幕右侧显示朗读进度浮窗，可点击暂停/继续",
            "scrollFollow.label": "朗读高度跟随",
            "scrollFollow.desc": "朗读时自动滚动对话区域，使当前朗读段落保持在屏幕垂直居中位置",
            "footnote": "由 Microsoft Edge TTS / 本地 RVC / 本地 Index-TTS2 驱动。",
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
            "host.indexUnreachable": "无法连接本地 Index-TTS2 服务",
            "host.indexHttpFail": "Index-TTS2 接口失败",
            "host.indexNoAudio": "Index-TTS2 返回的音频异常",
            "host.indexNeedsServer": "无法连接本地 Index-TTS2 服务",
            "host.indexVoicesFail": "Index-TTS2 音色列表接口异常",
            "host.indexUploadFail": "参考音频上传失败",
            "host.uploadRequired": "文件名与音频内容必填",
            "host.uploadEmpty": "音频内容为空",
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
            "read.raw": "朗读原始 Markdown 符号",
            "read.rawTip": "默认清洗代码块/表格/链接等符号后朗读；开启后逐字读出原始符号（适合朗读源码）",
            "toast.dismiss": "关闭",
            "toast.useEdge": "改用 Edge TTS 朗读",
            "toast.rvcFallback": "RVC 不可用，已临时改用 Edge TTS 朗读",
            "rvc.fallbackOn": "RVC 失败时自动改用 Edge TTS",
            "rvc.fallbackTip": "开启后：RVC 服务不可用或转换失败时，本条消息自动改用 Edge TTS 朗读。默认关闭——RVC 为纯本地处理，自动降级会把文本发送给微软在线端点",
            "notify.title": "事件语音提醒",
            "notify.desc": "会话内出现审批请求时用语音播报提醒：审批请求会打断当前朗读（高优先级），审批结果仅在空闲时播报。播报固定走 Edge TTS（不依赖 RVC 服务）。默认关闭",
            "notify.enabled": "启用审批语音提醒",
            "notify.approval": "审批请求（打断当前朗读）",
            "notify.approvalResult": "审批结果（空闲时播报）",
            "notify.voice": "提醒音色",
            "notify.approval.lead": "需要审批，",
            "notify.decided.lead": "审批结果：",
            "notify.decided.granted": "已批准",
            "notify.decided.rejected": "已拒绝",
            "notify.decided.settled": "已结束",
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
            "emptyText": "No readable text in this message",
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
            "diag.desc": "One-click check: Edge TTS synthesis, local RVC service + model, local Index-TTS2 service + reference voices",
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
            "provider.help": "Edge TTS: free online voices, works out of the box; Custom voice (RVC): use your own trained model, requires starting the conversion service; Local voice (Index-TTS2): reference-audio voices from your local index-tts2-nvidia bundle, requires its API service",
            "provider.rvc": "Custom voice (RVC)",
            "provider.index": "Local voice (Index-TTS2)",
            "section.index": "Index-TTS2 Config",
            "index.desc": "Connects to your local index-tts2-nvidia API service (default http://127.0.0.1:7880) and reads with a reference-audio voice. Start “启动api服务.bat” in the bundle first (keep it running), then Refresh voices and pick one",
            "index.onboard.title": "New to Index-TTS2? Three steps",
            "index.onboard.desc": "Reading with a local reference voice needs: ① a running local API service; ② reference audio in api/ckyp.",
            "index.onboard.steps": "① Double-click “启动api服务.bat” in the bundle (keep it running, default port 7880);\n② Click “Refresh voices” below and confirm the list shows up;\n③ Pick a reference voice and run diagnostics to confirm the service is online.",
            "index.field.baseUrl": "Service URL",
            "index.field.baseUrl.tip": "Usually keep default: the local Index-TTS2 API address (default port 7880)",
            "index.field.voice": "Reference voice",
            "index.field.voice.tip": "Sets who reads: a reference audio from the bundle's api/ckyp folder; Refresh syncs the list, or paste a filename / upload new audio",
            "index.refresh": "Refresh voices",
            "index.refreshing": "Refreshing…",
            "index.voices.none": "No reference voices yet: put wav/mp3 files into the bundle's api/ckyp folder, or upload below",
            "index.voices.fail": "Failed to load voices: ",
            "index.upload": "Upload reference audio",
            "index.uploading": "Uploading…",
            "index.upload.ok": "Uploaded: ",
            "index.upload.fail": "Upload failed: ",
            "index.upload.tip": "wav/mp3/flac/m4a/ogg supported; saved into the bundle's api/ckyp and ready to use",
            "index.cleanText": "Clean text before reading",
            "index.cleanText.tip": "Strip Markdown/links/HTML before synthesis (recommended for reading)",
            "index.emo.method": "Emotion control",
            "index.emo.method.tip": "0=follow reference audio; 1=another emotion reference; 2=emotion vector (advanced); 3=describe emotion in text",
            "index.emo.0": "Follow reference audio",
            "index.emo.1": "Emotion reference audio",
            "index.emo.2": "Emotion vector (advanced)",
            "index.emo.3": "Emotion text",
            "index.emo.weight": "Emotion strength",
            "index.emo.weight.tip": "How strongly the emotion reference affects the read",
            "index.emo.ref": "Emotion reference audio",
            "index.emo.ref.tip": "Used when emotion control is “Emotion reference audio”: read with another clip's emotion",
            "index.emo.text": "Emotion description",
            "index.emo.text.tip": "Used when emotion control is “Emotion text”, e.g. read happily",
            "index.emo.random": "Random emotion",
            "index.emo.random.tip": "Adds a random emotional variation per synthesis (more human, less stable)",
            "index.field.maxSeg": "Max text per segment",
            "index.field.maxSeg.tip": "Long text is split into segments: max text tokens per segment (bigger = more coherent, smaller = more stable)",
            "index.field.temperature": "Randomness",
            "index.field.temperature.tip": "Higher = more varied, lower = more stable (0.8 default)",
            "index.field.topP": "Top-P",
            "index.field.topP.tip": "Sampling cutoff: smaller = more conservative (0.8 default)",
            "field.voice": "Reading voice",
            "field.voice.tip": "Choose the speaking voice (Edge TTS mode only)",
            "preview.title": "Preview test",
            "preview.text": "Preview text",
            "preview.stop": "Stop preview",
            "preview.play": "Preview",
            "preview.playing": "Stop preview (playing)",
            "chunk.playing.lead": "Playing section ",
            "chunk.playing.tail": " · later sections synthesizing while playing…",
            "overlay.reading": "Reading",
            "overlay.paused": "Paused",
            "overlay.showToggle": "Show global reading indicator",
            "overlay.showToggle.desc": "Show a floating reading progress indicator on the right side; click to pause/resume",
            "scrollFollow.label": "Auto scroll while reading",
            "scrollFollow.desc": "Automatically scroll the conversation so the currently reading paragraph stays vertically centred",
            "footnote": "Powered by Microsoft Edge TTS / local RVC / local Index-TTS2.",
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
            "host.indexUnreachable": "Cannot connect to the local Index-TTS2 service",
            "host.indexHttpFail": "Index-TTS2 endpoint failed",
            "host.indexNoAudio": "Index-TTS2 returned invalid audio",
            "host.indexNeedsServer": "Cannot connect to the local Index-TTS2 service",
            "host.indexVoicesFail": "Index-TTS2 voices endpoint error",
            "host.indexUploadFail": "Reference audio upload failed",
            "host.uploadRequired": "filename and audio content are required",
            "host.uploadEmpty": "audio content is empty",
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
            "read.raw": "Read raw Markdown symbols",
            "read.rawTip": "Cleans code/table/link markup before reading by default; when on, symbols are read verbatim (for source code)",
            "toast.dismiss": "Dismiss",
            "toast.useEdge": "Read with Edge TTS instead",
            "toast.rvcFallback": "RVC unavailable — temporarily reading with Edge TTS",
            "rvc.fallbackOn": "Auto-switch to Edge TTS when RVC fails",
            "rvc.fallbackTip": "When on: if the RVC service is down or conversion fails, this message auto-reads with Edge TTS instead. Off by default — RVC is fully local; auto-fallback sends your text to Microsoft's online endpoint",
            "notify.title": "Event voice alerts",
            "notify.desc": "Voice-announce approval events from the session: approval requests interrupt the current read (high priority); results announce only when idle. Announcements always use Edge TTS (independent of the RVC service). Off by default",
            "notify.enabled": "Enable approval voice alerts",
            "notify.approval": "Approval requested (interrupts current read)",
            "notify.approvalResult": "Approval decided (announce when idle)",
            "notify.voice": "Alert voice",
            "notify.approval.lead": "Approval needed, ",
            "notify.decided.lead": "Approval result: ",
            "notify.decided.granted": "granted",
            "notify.decided.rejected": "rejected",
            "notify.decided.settled": "settled",
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
      // test/debug hook for the toast (client-load.mjs renders TtsToastHost and
      // asserts the toast appears with the message, then dismisses)
      try {
        if (typeof window !== "undefined")
          window.__dshTtsToast = {
            show: (text, kind, action) => showToast(text, kind, action),
            dismiss: () => dismissToast(),
            current: () => shared.toast,
          };
      } catch (e) {}
      // Debug hook: slot/snapshot shapes + a one-command DOM probe. When a
      // read-aloud button finds no text, run `__dshTtsDebug.dump()` in the
      // web console and paste the output into the bug report — it shows per
      // button how much ancestor text the DOM fallback can see (no full
      // message text leaves the page except the short preview you paste).
      try {
        if (typeof window !== "undefined")
          window.__dshTtsDebug = {
            build: CLIENT_BUILD,
            slotShapes: () => Object.assign({}, loggedSlotKeys),
            domTextFor: el => domTextForEl(el),
            dump: () => {
              const out = { slots: Object.assign({}, loggedSlotKeys), buttons: [] };
              try {
                const els = document.querySelectorAll(".dsh-tts-mini");
                for (let i = 0; i < els.length; i++) {
                  const t = domTextForEl(els[i]) || "";
                  const lv = domLevelsFor(els[i]).map(l => l.depth + ":" + l.len);
                  out.buttons.push({
                    index: i,
                    textLen: t.length,
                    levels: lv,
                    preview: t.slice(0, 80),
                  });
                }
              } catch (e) {
                out.error = String((e && e.message) || e);
              }
              return out;
            },
          };
      } catch (e) {}
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
        rvcAutoFallback: false, // RVC read failed -> silently retry with Edge TTS (opt-in; off by default for privacy)
        rawMarkdown: false, // read raw Markdown symbols verbatim (default off = cleaned)
        rvc: {
          baseUrl: "http://127.0.0.1:4892",
          model: "",
          index: "",
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
        index: {
          baseUrl: "http://127.0.0.1:7880",
          voice: "",
          cleanText: true,
          emoControlMethod: 0,
          emoRefPath: "",
          emoWeight: 0.65,
          emoText: "",
          emoRandom: false,
          maxTextTokensPerSegment: 120,
          doSample: true,
          topP: 0.8,
          topK: 30,
          temperature: 0.8,
          lengthPenalty: 0.0,
          numBeams: 3,
          repetitionPenalty: 10.0,
          maxMelTokens: 1500,
        },
        speaking: false,
        currentText: null,
        speakSource: null,
        speakToken: 0,
        paused: false,       // mini-player: playback paused
        rate: 1,             // mini-player: playback speed (1 / 1.25 / 1.5)
        chunkProgress: null, // { index: 1-based chunk now playing, total } during chunked playback
        readingIndex: null,   // 1-based paragraph index currently being read (for overlay)
        readingSentences: null, // array of sentence texts split from currentText (for scroll-center)
        readingSentenceIdx: 0,  // 0-based index of the sentence currently centered
        readingMsgEl: null,   // WeakRef to the message DOM node being read (anchored from the read button)
        showReadingOverlay: true, // show the global reading progress overlay on the right
        showScrollFollow: true,   // auto-scroll conversation to keep reading paragraph centred
        currentJobId: null,  // active RVC chunked job, cancelled eagerly on stop
        toast: null,         // { text, kind: "error"|"warn", action: {label,onClick} } transient toast, or null
        notify: {
          // Approval voice alerts (Agent-event voice broadcast). off by default.
          enabled: false,
          approval: true,        // approval/asked -> interrupts current read
          approvalResult: false, // approval/decided -> announce only when idle
          voice: "zh-CN-XiaoxuanNeural",
        },
        notifyCursor: 0,        // last /dsh-tts-api/notify sequence consumed
        notifyBaselined: false, // first poll syncs the cursor without announcing (no replay after refresh)
        removedVoices: new Set(), // Edge voices the endpoint rejected (1007) this session
        audioEl: null,
        spareAudioEl: null, // second <audio> used for ping-pong chunk playback (fallback)
        audioCtx: null,     // shared Web Audio context (chunked playback)
        waCleanup: null,    // stop() the active Web Audio chain
        lastSeqBySession: new Map(),
        lastWatchKey: undefined, // last session key rendered by the auto-read watcher (switch detector)
        livelySeen: new Map(),   // key -> true once the session proves alive (persistent liveness latch)
        livelySrc: new Map(),    // key -> which feeder latched (for the speak-reason log)
        userSeqSeen: new Map(),  // key -> max user-node rank observed (liveness feeder)
        userLatchAt: new Map(),  // key -> Date.now() of the user-growth latch (aging gate)
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
      const INDEX_DEFAULTS = {
        baseUrl: "http://127.0.0.1:7880",
        voice: "",
        cleanText: true,
        emoControlMethod: 0,
        emoRefPath: "",
        emoWeight: 0.65,
        emoText: "",
        emoRandom: false,
        maxTextTokensPerSegment: 120,
        doSample: true,
        topP: 0.8,
        topK: 30,
        temperature: 0.8,
        lengthPenalty: 0.0,
        numBeams: 3,
        repetitionPenalty: 10.0,
        maxMelTokens: 1500,
      };
      const sharedDefaults = {
        autoRead: false,
        voice: "zh-CN-XiaoxuanNeural",
        provider: "edge-tts",
        rvcAutoFallback: false,
        rawMarkdown: false,
        notify: {
          enabled: false,
          approval: true,
          approvalResult: false,
          voice: "zh-CN-XiaoxuanNeural",
        },
      };
      // Layered storage split: these RVC keys are service-class config owned
      // by the Host file (~/.dsh/tts-rvc/settings.json); everything else in
      // shared.rvc is a UI pref and stays in localStorage.
      // Index-TTS2: only baseUrl is service-class; voice + params stay local.
      const HOST_RVC_KEYS = ["baseUrl", "model", "index"];
      const HOST_INDEX_KEYS = ["baseUrl"];
      function loadSettings() {
        try {
          const store = globalThis.localStorage;
          if (!store) return;
          const raw = store.getItem(SETTINGS_KEY);
          if (!raw) return;
          const data = JSON.parse(raw);
          if (typeof data.autoRead === "boolean") shared.autoRead = data.autoRead;
          if (typeof data.voice === "string") shared.voice = data.voice;
          if (data.provider === "edge-tts" || data.provider === "rvc" || data.provider === "index-tts2")
            shared.provider = data.provider;
          if (typeof data.rvcAutoFallback === "boolean")
            shared.rvcAutoFallback = data.rvcAutoFallback;
          if (typeof data.rawMarkdown === "boolean")
            shared.rawMarkdown = data.rawMarkdown;
          if (typeof data.showReadingOverlay === "boolean")
            shared.showReadingOverlay = data.showReadingOverlay;
          if (typeof data.showScrollFollow === "boolean")
            shared.showScrollFollow = data.showScrollFollow;
          if (data.rvc && typeof data.rvc === "object") {
            for (const k in RVC_DEFAULTS) {
              if (k in data.rvc) shared.rvc[k] = data.rvc[k];
            }
          }
          if (data.index && typeof data.index === "object") {
            for (const k in INDEX_DEFAULTS) {
              if (k in data.index) shared.index[k] = data.index[k];
            }
          }
          if (data.notify && typeof data.notify === "object") {
            for (const k in sharedDefaults.notify) {
              if (k in data.notify) shared.notify[k] = data.notify[k];
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
          // Layered storage: service-class RVC config (baseUrl/model/index)
          // lives on the Host file and is NOT persisted to localStorage, so a
          // browser-data clear / incognito / browser switch never loses it.
          // UI prefs + the rest of shared.rvc stay local. Same for Index-TTS2
          // (only baseUrl is service-class).
          const rvcLocal = Object.assign({}, shared.rvc);
          for (const k of HOST_RVC_KEYS) delete rvcLocal[k];
          const indexLocal = Object.assign({}, shared.index);
          for (const k of HOST_INDEX_KEYS) delete indexLocal[k];
          const data = {
            autoRead: shared.autoRead,
            voice: shared.voice,
            provider: shared.provider,
            rvcAutoFallback: shared.rvcAutoFallback,
            rawMarkdown: shared.rawMarkdown,
            showReadingOverlay: shared.showReadingOverlay,
            showScrollFollow: shared.showScrollFollow,
            rvc: rvcLocal,
            index: indexLocal,
            notify: Object.assign({}, shared.notify),
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
        shared.rvcAutoFallback = sharedDefaults.rvcAutoFallback;
        shared.rawMarkdown = sharedDefaults.rawMarkdown;
        shared.showReadingOverlay = true;
        shared.showScrollFollow = true;
        for (const k in sharedDefaults.notify) shared.notify[k] = sharedDefaults.notify[k];
        for (const k in RVC_DEFAULTS) shared.rvc[k] = RVC_DEFAULTS[k];
        for (const k in INDEX_DEFAULTS) shared.index[k] = INDEX_DEFAULTS[k];
        try {
          const store = globalThis.localStorage;
          if (store) store.removeItem(SETTINGS_KEY);
        } catch (e) {}
        // best-effort: reset the Host service config too (defaults = clear keys)
        try {
          pushHostRvc({ baseUrl: "", model: "", index: "" });
        } catch (e) {}
        try {
          pushHostIndex({ baseUrl: "" });
        } catch (e) {}
        notify();
      }
      // Push service-class keys to the Host file (fire-and-forget, non-fatal).
      function pushHostRvc(patch) {
        try {
          fetch("/dsh-tts-api/rvc-config-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rvc: patch }),
          }).catch(() => {});
        } catch (e) {}
      }
      function pushHostIndex(patch) {
        try {
          fetch("/dsh-tts-api/index-config-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: patch }),
          }).catch(() => {});
        } catch (e) {}
      }
      // Pull the Host service config once at startup: the file wins over any
      // legacy localStorage values; when the file is empty but legacy values
      // exist, migrate them up to the Host once.
      function pullHostRvc() {
        try {
          fetch("/dsh-tts-api/rvc-config")
            .then(r => r.json().catch(() => null))
            .then(d => {
              try {
                const srv = (d && d.rvc) || {};
                const legacy = {};
                try {
                  const raw = globalThis.localStorage
                    ? globalThis.localStorage.getItem(SETTINGS_KEY)
                    : null;
                  const data = raw ? JSON.parse(raw) : null;
                  if (data && data.rvc && typeof data.rvc === "object") {
                    for (const k of HOST_RVC_KEYS) {
                      if (typeof data.rvc[k] === "string" && data.rvc[k] !== "") {
                        legacy[k] = data.rvc[k];
                      }
                    }
                  }
                } catch (e) {}
                let changed = false;
                for (const k of HOST_RVC_KEYS) {
                  if (typeof srv[k] === "string" && srv[k] !== "") {
                    if (shared.rvc[k] !== srv[k]) {
                      shared.rvc[k] = srv[k];
                      changed = true;
                    }
                  }
                }
                if (changed) notify();
                // migrate: file empty + legacy present -> push legacy up once
                const needPush = {};
                let hasPush = false;
                for (const k of HOST_RVC_KEYS) {
                  const fileEmpty = !(typeof srv[k] === "string" && srv[k] !== "");
                  if (fileEmpty && legacy[k] !== undefined) {
                    needPush[k] = legacy[k];
                    hasPush = true;
                  }
                }
                if (hasPush) pushHostRvc(needPush);
              } catch (e) {}
            })
            .catch(() => {});
        } catch (e) {}
      }
      // Pull the Host Index-TTS2 service address once at startup (same layered
      // pattern as RVC: file wins; legacy local value migrates up once).
      function pullHostIndex() {
        try {
          fetch("/dsh-tts-api/index-config")
            .then(r => r.json().catch(() => null))
            .then(d => {
              try {
                const srv = (d && d.index) || {};
                let legacy;
                try {
                  const raw = globalThis.localStorage
                    ? globalThis.localStorage.getItem(SETTINGS_KEY)
                    : null;
                  const data = raw ? JSON.parse(raw) : null;
                  if (data && data.index && typeof data.index.baseUrl === "string" && data.index.baseUrl !== "") {
                    legacy = data.index.baseUrl;
                  }
                } catch (e) {}
                if (typeof srv.baseUrl === "string" && srv.baseUrl !== "") {
                  if (shared.index.baseUrl !== srv.baseUrl) {
                    shared.index.baseUrl = srv.baseUrl;
                    notify();
                  }
                } else if (legacy !== undefined) {
                  pushHostIndex({ baseUrl: legacy });
                }
              } catch (e) {}
            })
            .catch(() => {});
        } catch (e) {}
      }
      loadSettings();
      pullHostRvc();
      pullHostIndex();
      try {
        if (typeof window !== "undefined")
          window.__dshTtsSettings = {
            get: () => ({
              autoRead: shared.autoRead,
              voice: shared.voice,
              provider: shared.provider,
              rvcAutoFallback: shared.rvcAutoFallback,
              rawMarkdown: shared.rawMarkdown,
              rvc: Object.assign({}, shared.rvc),
              index: Object.assign({}, shared.index),
              notify: Object.assign({}, shared.notify),
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

      // ---------- toast (transient, themed error/warn notification) ----------
      // Errors that happen *outside* the settings preview (message read-aloud,
      // auto-read, chunk playback) had nowhere to land — they only reset the
      // icon and logged to console. A small fixed toast in shell.overlay makes
      // them visible: auto-dismisses, has a close button, and can carry one
      // action button (e.g. "read with Edge instead" after an RVC failure).
      let toastTimer = null;
      function showToast(text, kind, action) {
        shared.toast = { text: String(text), kind: kind || "error", action: action || null };
        notify();
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          shared.toast = null;
          notify();
        }, 6000);
      }
      function dismissToast() {
        if (toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
        }
        shared.toast = null;
        notify();
      }
      // Edge voice used when an RVC read falls back to plain Edge TTS: reuse the
      // RVC base voice (the timbre the user picked for conversion) when it comes
      // from Edge, otherwise the configured reading voice.
      function fallbackEdgeVoice() {
        return shared.rvc.baseVoice || shared.voice;
      }

      // ---------- approval voice alerts (Agent-event broadcast) ----------
      // The Host ingests approval session events (approval/asked, approval/
      // decided) from the session/event firehose and serves them through
      // /dsh-tts-api/notify?s=N. The poller picks them up and reads a short
      // alert aloud: requests INTERRUPT the current read (high priority, the
      // agent is waiting on the decision); results announce only when idle.
      // Alerts always use Edge TTS with the configured alert voice and never
      // surface error toasts (they must not spam while the agent loops).
      function announceNotify(item) {
        if (!shared.notify.enabled) return;
        let text = "";
        if (item.kind === "approval") {
          if (!shared.notify.approval) return;
          text = t("notify.approval.lead");
          if (item.toolName) text += item.toolName;
          if (item.reason) text += "，" + item.reason;
        } else if (item.kind === "approval-decided") {
          if (!shared.notify.approvalResult) return;
          text =
            t("notify.decided.lead") +
            (item.outcome === "granted"
              ? t("notify.decided.granted")
              : item.outcome === "rejected"
                ? t("notify.decided.rejected")
                : t("notify.decided.settled"));
        }
        if (!text) return;
        if (item.kind !== "approval" && shared.speaking) return; // idle-only
        speakText(text, "notify", () => {}, {
          provider: "edge-tts",
          voice: shared.notify.voice || "zh-CN-XiaoxuanNeural",
        });
      }

      function plainText(text) {
        // opt-in: read raw Markdown symbols verbatim (for source-code reads).
        if (shared.rawMarkdown) {
          return String(text || "")
            .replace(/[ \t]+/g, " ")
            .replace(/\s*\n\s*/g, " ")
            .trim();
        }
        return String(text || "")
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/`([^`]*)`/g, "$1")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/<[^>]+>/g, " ")
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/^>\s?/gm, "")
          .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
          .replace(/^\s*[-*+]\s+/gm, "")
          .replace(/^\s*\d+\.\s+/gm, "")
          .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, " ")
          .replace(/\|/g, " ")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/__([^_]+)__/g, "$1")
          .replace(/~~([^~]+)~~/g, "$1")
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\n\s*/g, " ")
          .trim();
      }

      // ---------- paragraph splitting (for scroll-center tracking) ----------
      // Split text into paragraph-level segments matching how the TTS server
      // chunks text.  The server typically splits on paragraph boundaries
      // (double newlines, single newlines, or natural breaks).  We split by
      // the same boundaries so each array element maps 1:1 to a server chunk.
      function splitParagraphs(text) {
        if (!text) return [];
        const raw = String(text);
        // Split on paragraph breaks: double newline, or single newline that
        // follows sentence-ending punctuation (common in markdown).
        const parts = raw.split(/\n\s*\n|\n(?=[^\n]{4,})/);
        const out = [];
        for (let i = 0; i < parts.length; i++) {
          const s = parts[i].trim();
          if (s) out.push(s);
        }
        return out.length ? out : [text];
      }

      // ---------- robust message-text resolution ----------
      // The host's message shape has drifted across DSH versions (kind/type,
      // text/content/markdown, blocks/parts/content, messageId/id, nodes vs
      // messages). The read-aloud button used to accept exactly one shape
      // ({kind:"text",text} + kind==="assistant" + messageId), so any skew
      // left it with empty text -> permanently grey/disabled while the
      // settings preview (which bypasses session data) kept working.
      // These helpers accept every known shape plus a DOM fallback, so a
      // contract skew degrades to "still reads" instead of "dead button".
      function getBlockText(b) {
        if (b == null) return "";
        if (typeof b === "string") return b;
        if (typeof b.text === "string" && b.text) return b.text;
        const keys = ["content", "markdown", "body", "value", "data"];
        for (const k of keys) {
          if (typeof b[k] === "string" && b[k]) return b[k];
        }
        return "";
      }
      function isTextBlock(b) {
        if (b == null || typeof b === "string") return true;
        const k = b.kind !== undefined ? b.kind : b.type;
        if (k === undefined) return true;
        const s = String(k).toLowerCase();
        return s === "text" || s === "markdown" || s === "paragraph" ||
          s === "code" || s === "textblock";
      }
      function extractText(input) {
        if (input == null) return "";
        if (typeof input === "string") return input;
        if (Array.isArray(input)) {
          let text = "";
          for (const b of input) {
            if (!isTextBlock(b)) continue;
            const t = getBlockText(b);
            if (t) text += (text ? "\n" : "") + t;
          }
          return text;
        }
        if (typeof input === "object") {
          const lists = ["blocks", "parts", "content", "items", "children"];
          for (const k of lists) {
            const v = input[k];
            if (Array.isArray(v)) {
              const t = extractText(v);
              if (t) return t;
            } else if (typeof v === "string" && v.trim()) {
              return v;
            }
          }
          const wraps = ["message", "data", "node", "entry"];
          for (const k of wraps) {
            const v = input[k];
            if (v && typeof v === "object") {
              const t = extractText(v);
              if (t) return t;
            }
          }
          return getBlockText(input);
        }
        return "";
      }
      // Candidate keys holding a node/message list inside a snapshot.
      // Real-host contract (from console probes): the canonical message list
      // is useTrajectory.eventNodes ([{kind,seq,messageId,time,turn,step,
      // blocks,usage}]), mirrored as useChat.legacy.nodes; useChat.nodes is
      // an internal store whose byKey sub-map holds the same nodes.
      const NODE_LIST_KEYS = ["nodes", "messages", "items", "events", "entries", "turns", "eventNodes"];
      const SNAP_WRAP_KEYS = ["session", "data", "conversation", "trajectory", "chat"];
      // Object-map stores ({id: node}, the host's useChat.nodes shape):
      // return the values when they are all plain objects, else null.
      function mapValues(obj) {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
        const ks = Object.keys(obj);
        if (!ks.length || ks.length > 20000) return null;
        const vals = [];
        for (const k of ks) {
          const v = obj[k];
          if (!v || typeof v !== "object" || Array.isArray(v)) return null;
          vals.push(v);
        }
        return vals.length ? vals : null;
      }
      // One value -> node list: plain array, store-shape { byKey: {...} },
      // or object-map store (values ARE the nodes; id/text guards downstream
      // keep location-like maps harmless).
      function nodesFromValue(v) {
        if (Array.isArray(v)) return v;
        if (v && typeof v === "object") {
          if (v.byKey && typeof v.byKey === "object") {
            const mv = mapValues(v.byKey);
            if (mv) return mv;
          }
          const mv = mapValues(v);
          if (mv) return mv;
        }
        return null;
      }
      function pickNodes(snap) {
        if (!snap) return null;
        if (Array.isArray(snap)) return snap;
        if (typeof snap !== "object") return null;
        for (const k of NODE_LIST_KEYS) {
          const r = nodesFromValue(snap[k]);
          if (r) return r;
        }
        for (const k of SNAP_WRAP_KEYS) {
          const v = snap[k];
          if (!v) continue;
          if (Array.isArray(v)) return v;
          if (typeof v === "object") {
            for (const k2 of NODE_LIST_KEYS) {
              const r = nodesFromValue(v[k2]);
              if (r) return r;
            }
          }
        }
        return null;
      }
      // Snapshot hooks exposed on slot props, in fixed call order. Real-host
      // logs show useSession carries only queue state (no nodes); the message
      // history lives behind one of the conversation hooks, so every present
      // hook is snapshotted and searched (order is stable per host).
      const SNAP_HOOKS = ["useSession", "useConversation", "useChat",
        "useTrajectory", "useProjection", "useResource"];
      // Hooks eligible as the auto-read "newest message" source (content
      // hooks only; session-list/UI-state hooks would elect the wrong newest).
      // Canonical first: useTrajectory.eventNodes, then the useChat mirrors.
      const AUTO_HOOKS = ["useTrajectory", "useChat", "useConversation",
        "useProjection", "useSession"];
      function collectSnaps(props) {
        const out = [];
        for (const name of SNAP_HOOKS) {
          const h = props && props[name];
          if (typeof h !== "function") continue;
          let s = null;
          try {
            s = h(sv => sv);
          } catch (e) { s = null; }
          out.push({ name: name, snap: s });
        }
        return out;
      }
      function findNodeInSnaps(snaps, wid) {
        if (!wid) return null;
        const match = n => n && String(nodeIdOf(n)) === String(wid);
        for (const entry of snaps) {
          const nodes = pickNodes(entry.snap);
          if (!nodes) continue;
          for (const n of nodes) {
            if (match(n)) return n;
            // one nested level (view objects carrying messages/nodes arrays)
            if (n && typeof n === "object") {
              for (const k of NODE_LIST_KEYS) {
                const inner = n[k];
                if (Array.isArray(inner)) {
                  for (const m of inner) {
                    if (match(m)) return m;
                  }
                }
              }
            }
          }
        }
        return null;
      }
      // A node trusted enough to elect a watch source: explicit assistant
      // role with text, or an id-bearing object with text. Untyped id-less
      // blobs (view metadata, contexts) must never become the watch source.
      function isWatchCandidate(n) {
        if (!n || typeof n !== "object") return false;
        if (!extractText(n).trim()) return false;
        const role = n.kind !== undefined ? n.kind
          : (n.role !== undefined ? n.role : n.type);
        if (role !== undefined && role !== null) return isAssistantNode(n);
        return nodeIdOf(n) !== null;
      }
      // First content list (in AUTO_HOOKS priority) holding a trusted
      // assistant node with real text — the auto-read watch source.
      function pickAutoList(snaps) {
        for (const name of AUTO_HOOKS) {
          for (const entry of snaps) {
            if (entry.name !== name) continue;
            const nodes = pickNodes(entry.snap);
            if (!nodes || !nodes.length) continue;
            let hasText = false;
            for (const n of nodes) {
              if (isWatchCandidate(n)) {
                hasText = true;
                break;
              }
            }
            if (hasText) return { name: name, nodes: nodes };
          }
        }
        return null;
      }
      function isAssistantNode(n) {
        if (!n || typeof n !== "object") return false;
        const role = n.kind !== undefined ? n.kind
          : (n.role !== undefined ? n.role : n.type);
        if (role === undefined || role === null) return true;
        const s = String(role).toLowerCase();
        return s === "assistant" || s === "ai" || s === "model" ||
          s === "bot" || s === "agent" || s.indexOf("assistant") >= 0;
      }
      function nodeSeq(n) {
        const keys = ["seq", "order", "index", "idx", "createdAt", "ts"];
        for (const k of keys) {
          const v = n[k];
          if (typeof v === "number" && isFinite(v)) return v;
        }
        return null;
      }
      // Explicit user-side nodes only (strict: untyped objects do NOT count,
      // so location/call records can never latch liveness by accident).
      function isUserNode(n) {
        if (!n || typeof n !== "object") return false;
        const role = n.kind !== undefined ? n.kind
          : (n.role !== undefined ? n.role : n.type);
        if (role === undefined || role === null) return false;
        const s = String(role).toLowerCase();
        return s === "user" || s === "human" || s === "member" ||
          s.indexOf("user") >= 0;
      }
      // Agent visibly working in this snapshot: running flag, queued work, or
      // a streaming partial. (Past `requests` are history, NOT activity.)
      function snapActive(s) {
        if (!s || typeof s !== "object") return false;
        if (s.running === true) return true;
        const queues = ["queue", "pendingSubmissions", "runningCalls"];
        for (const k of queues) {
          if (Array.isArray(s[k]) && s[k].length) return true;
        }
        if (s.partial !== undefined && s.partial !== null) return true;
        return false;
      }
      function idStr(v) {
        if (typeof v === "string" && v) return v;
        if (typeof v === "number" && isFinite(v)) return String(v);
        return null;
      }
      function nodeIdOf(n) {
        if (!n || typeof n !== "object") return null;
        const keys = ["messageId", "id", "nodeId", "key"];
        for (const k of keys) {
          const s = idStr(n[k]);
          if (s) return s;
        }
        return null;
      }
      function wantedIdOf(props) {
        if (!props || typeof props !== "object") return null;
        const keys = ["messageId", "id", "nodeId", "messageID", "key"];
        for (const k of keys) {
          const s = idStr(props[k]);
          if (s) return s;
        }
        return null;
      }
      // Resolve the readable text for a message-action slot from every known
      // prop/snapshot shape. `snaps` is the collectSnaps() array (searched
      // across all hooks by id); the legacy props.session object is covered
      // too. Returns "" when nothing matches (the caller then tries the DOM
      // fallback before giving up).
      function resolveMessageText(props, snaps) {
        props = props || {};
        const direct = ["text", "content", "markdown", "body", "messageText"];
        for (const k of direct) {
          const v = props[k];
          if (typeof v === "string" && v.trim()) return v;
        }
        const wraps = ["node", "message", "entry", "item", "data"];
        for (const k of wraps) {
          const v = props[k];
          if (v && (typeof v === "object" || typeof v === "string")) {
            const t = extractText(v);
            if (t && t.trim()) return t;
          }
        }
        const wid = wantedIdOf(props);
        if (wid) {
          const found = Array.isArray(snaps)
            ? findNodeInSnaps(snaps, wid)
            : null;
          if (found) {
            const t = extractText(found);
            if (t) return t;
          }
          const legacy = pickNodes(props.session);
          if (legacy) {
            for (const n of legacy) {
              if (n && String(nodeIdOf(n)) === String(wid)) {
                const t = extractText(n);
                if (t) return t;
              }
            }
          }
          return "";
        }
        return "";
      }
      // Last-resort fallback: read the visible message text out of the DOM
      // next to our own action button. The ref sits on our own .dsh-tts-mini
      // div whose parent is just the actions row (empty once our buttons are
      // stripped), so climb several ancestors: the first ancestor carrying
      // substantial text after stripping chrome is the message bubble. Never
      // matches on data-* attributes alone, so host DOM renames cannot break
      // it again.
      const DOM_CHROME_SEL =
        "button,input,textarea,select,script,style," +
        ".dsh-tts-mini,.dsh-tts-action,.dsh-tts-sel-wrap";
      // Stripped text per ancestor level (bottom-up), used by the picker
      // below and by __dshTtsDebug.dump() for bug reports.
      function domLevelsFor(el) {
        const out = [];
        try {
          if (!el) return out;
          let cur = null;
          try {
            cur = el.parentElement || null;
          } catch (e) { cur = null; }
          for (let depth = 0; depth < 7 && cur; depth++) {
            let t = "";
            try {
              const clone = cur.cloneNode(true);
              let kill = [];
              try {
                kill = clone.querySelectorAll
                  ? clone.querySelectorAll(DOM_CHROME_SEL)
                  : [];
              } catch (e) { kill = []; }
              for (const b of kill) {
                try { b.remove(); } catch (e) {}
              }
              t = ((clone.innerText || clone.textContent) || "").trim();
            } catch (e) { t = ""; }
            out.push({ depth: depth, len: t.length, preview: t.slice(0, 60), text: t });
            try {
              cur = cur.parentElement || null;
            } catch (e) { cur = null; }
          }
        } catch (e) {}
        return out;
      }
      function domTextForEl(el) {
        try {
          const levels = domLevelsFor(el);
          // Tier 1: the message bubble is the nearest ancestor holding a
          // real sentence; timestamps/crumbs on the actions row stay below it.
          for (const l of levels) {
            if (l.text.replace(/[\s\u200b]+/g, "").length >= 20) {
              return l.text.length > 20000 ? l.text.slice(0, 20000) : l.text;
            }
          }
          // Tier 2: short message — longest text among the nearest levels.
          let best = null;
          for (const l of levels) {
            if (l.depth > 3) break;
            if (l.text.replace(/[\s\u200b]+/g, "").length >= 2 &&
                (!best || l.text.length > best.text.length)) best = l;
          }
          if (best) return best.text;
          return "";
        } catch (e) { return ""; }
      }
      // Mount diagnostics: which prop keys the host passed per slot, plus the
      // session-snapshot shape (top-level keys + node count + first-node keys;
      // never message text). Logged when the key set changes and exposed via
      // window.__dshTtsDebug for one-command bug reports.
      const loggedSlotKeys = {};
      // One level deeper than key names (still PII-free: types, counts and
      // key names only, plus the first text-bearing node's text LENGTH so we
      // can confirm extraction works without seeing content).
      function describeVal(v) {
        try {
          if (v == null) return "null";
          if (Array.isArray(v)) {
            const e0 = v[0];
            let et = "empty";
            if (e0 != null) {
              et = Array.isArray(e0) ? "arr" : typeof e0;
              if (et === "object" && e0) {
                et = "obj{" + Object.keys(e0).slice(0, 8).join("+") + "}";
              }
            }
            return "arr[" + v.length + "]<" + et + ">";
          }
          if (typeof v === "object") {
            const ks = Object.keys(v);
            const first = v[ks[0]];
            const fv = first && typeof first === "object" && !Array.isArray(first)
              ? "val{" + Object.keys(first).slice(0, 8).join("+") + "}"
              : (Array.isArray(first) ? "valArr[" + first.length + "]" : typeof first);
            return "obj#" + ks.length + "{" + ks.slice(0, 8).join("+") + "}/" + fv;
          }
          return typeof v;
        } catch (e) { return "?"; }
      }
      function describeSnap(snap) {
        try {
          if (!snap) return "none";
          if (Array.isArray(snap)) return "array[" + snap.length + "]";
          const keys = Object.keys(snap);
          const deep = keys.slice(0, 10).map(k => k + "=" + describeVal(snap[k])).join(" ");
          const nodes = pickNodes(snap);
          let head = "";
          if (nodes && nodes.length) {
            const n0 = nodes[0];
            head = " firstNode:" + (n0 && typeof n0 === "object"
              ? Object.keys(n0).slice(0, 12).join("+")
              : typeof n0);
            for (const n of nodes) {
              if (n && typeof n === "object") {
                const len = extractText(n).replace(/\s+/g, "").length;
                if (len > 0) {
                  head += " firstTextLen:" + len;
                  break;
                }
              }
            }
          }
          let st = "";
          try {
            if (typeof snap.running === "boolean") st += " run:" + snap.running;
            const qks = ["queue", "pendingSubmissions", "runningCalls"];
            for (const qk of qks) {
              if (Array.isArray(snap[qk])) st += " " + qk + ":" + snap[qk].length;
            }
            if (snap.partial !== undefined && snap.partial !== null) st += " partial:1";
          } catch (e) {}
          return "keys:" + keys.slice(0, 12).join("+") +
            " [" + deep + "] nodes:" + (nodes ? nodes.length : 0) + head + st;
        } catch (e) { return "?"; }
      }
      function describeSnaps(snaps) {
        if (!Array.isArray(snaps) || !snaps.length) return "no-snaps";
        return snaps.map(entry =>
          entry.name + "={" + describeSnap(entry.snap) + "}",
        ).join(" ");
      }
      function logSlotPropsOnce(slot, props, snaps) {
        try {
          const keys = props ? Object.keys(props).sort().join(",") : "";
          const shape = snaps !== undefined
            ? "|" + (Array.isArray(snaps) ? describeSnaps(snaps) : describeSnap(snaps))
            : "";
          const sig = keys + shape;
          if (loggedSlotKeys[slot] === sig) return;
          loggedSlotKeys[slot] = sig;
          console.info("[tts] slot: " + slot + " props: " + keys + shape);
        } catch (e) {}
      }

      function clearSpeaking(token) {
        if (token === shared.speakToken) {
          shared.speaking = false;
          shared.currentText = null;
          shared.speakSource = null;
          shared.chunkProgress = null;
          shared.readingIndex = null;
          shared.readingSentences = null;
          shared.readingSentenceIdx = 0;
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
        shared.readingIndex = null;
        shared.readingSentences = null;
        shared.readingSentenceIdx = 0;
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
        if (!voice || shared.provider !== "edge-tts") return false;
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

      async function rpcSpeak(text, voice, provider) {
        // `provider` defaults to the active provider; an explicit override is
        // used by the RVC->Edge fallback (auto or one-click) so a failed RVC
        // read can be re-synthesized with plain Edge TTS without flipping the
        // persisted provider.
        const useProvider = provider || shared.provider;
        const payload = { text, voice, provider: useProvider };
        const pct = v =>
          v === 0 ? "default" : (v > 0 ? "+" : "") + v + "%";
        if (useProvider === "rvc") {
          const r = shared.rvc;
          const custom = Object.assign({}, r, {
            baseRate: pct(r.baseRate),
            basePitch: pct(r.basePitch),
            baseVolume: pct(r.baseVolume),
          });
          payload.custom = custom;
        } else if (useProvider === "index-tts2") {
          // Index-TTS2: timbre comes from the reference audio (shared.index.voice);
          // the `voice` slot is only a fallback when nothing is chosen yet.
          payload.custom = Object.assign({}, shared.index, {
            voice: shared.index.voice || voice,
          });
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
          shared.readingIndex = Math.min(index, total);
          // Block-start timestamp: lets the scroll-follow heartbeat
          // interpolate a smooth in-chunk ratio instead of jumping per chunk.
          shared.chunkStartedAt = Date.now();
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
          shared.readingIndex = index;
          // Block-start timestamp for smooth in-chunk scroll interpolation.
          shared.chunkStartedAt = Date.now();
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
              clearInterval(cancelCheck);
              resolve();
            };
            cur.onended = fin;
            cur.onerror = () => {
              fin();
              if (typeof onError === "function") onError(t("err.chunkSkip"));
            };
            // FIX: poll for token cancellation so stopSpeaking() doesn't
            // leave this Promise hanging forever (audio paused → onended
            // never fires → playOne stuck → finally block never runs →
            // DOM leak + potential overlapping audio on next speakText).
            const cancelCheck = setInterval(() => {
              if (token !== shared.speakToken) fin();
            }, 150);
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

      async function speakText(rawText, source, onError, opts) {
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
        shared.readingSentences = splitParagraphs(rawText);
        shared.readingSentenceIdx = 0;
        // Single-file reads (short Edge/RVC/Index texts) never enter the
        // chunked queue below, so without an initial value chunkProgress /
        // readingIndex stay null forever -> overlay stays hidden and the
        // scroll-follow guard bails out. Seed a 1/1 progress immediately so
        // the overlay, scroll-follow and click-to-pause work for EVERY read;
        // the chunked branch overwrites this with the real total.
        shared.chunkProgress = { index: 1, total: 1 };
        shared.readingIndex = 1;
        // Playback-start timestamp for smooth scroll interpolation.
        shared.chunkStartedAt = Date.now();
        // New utterance: drop the previous message anchor (button clicks
        // re-anchor below; auto-read resolves on first successful lookup).
        shared.readingMsgEl = null;
        notify();
        // Explicit provider override (one-click RVC->Edge fallback) else active.
        const provider = (opts && opts.provider) || shared.provider;
        // An explicit voice override (approval alerts pick their own alert
        // voice); falling back from RVC to Edge reuses the RVC base voice when
        // it came from Edge (closest to the configured timbre), else the
        // configured reading voice.
        const voice =
          (opts && opts.voice) ||
          (provider === "edge-tts" && shared.provider === "rvc"
            ? fallbackEdgeVoice()
            : shared.voice);
        try {
          let result = await rpcSpeak(trimmed, voice, provider);
          if (token !== shared.speakToken)
            return { ok: false, error: "interrupted" };
          // Opt-in auto-fallback: an RVC read failed -> silently retry with
          // Edge TTS. Only for the ACTIVE RVC provider and not already a
          // fallback attempt. Long RVC reads fail at /speak time (prewarm), so
          // this single error path covers both short and chunked reads.
          if (
            result &&
            result.error &&
            shared.provider === "rvc" &&
            !(opts && opts.provider) &&
            shared.rvcAutoFallback
          ) {
            const r2 = await rpcSpeak(trimmed, fallbackEdgeVoice(), "edge-tts");
            if (token !== shared.speakToken)
              return { ok: false, error: "interrupted" };
            if (r2 && !r2.error) {
              result = r2;
              showToast(t("toast.rvcFallback"), "warn");
            }
          }
          if (!result || result.error) {
            const errText = String(
              (result && result.error) || t("err.synthFailShort"),
            );
            const pruned = pruneRemovedVoice(errText);
            clearSpeaking(token);
            console.error("[tts] synthesize failed:", errText);
            if (pruned && typeof onError === "function")
              onError(t("voice.removed"));
            else if (typeof onError === "function") onError(errText);
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
            if (typeof onError === "function") onError(errTextOf(e));
            return { ok: false, error: String((e && e.message) || e) };
          }
          return { ok: true };
        } catch (e) {
          const errText2 = String((e && e.message) || e);
          console.error("[tts] rpc failed:", errText2);
          const pruned = pruneRemovedVoice(errText2);
          clearSpeaking(token);
          if (pruned && typeof onError === "function")
            onError(t("voice.removed"));
          else if (typeof onError === "function") onError(errText2);
          return { ok: false, error: errText2 };
        }
      }

      function errTextOf(e) {
        const s = String((e && e.message) || e || "");
        return s || t("err.audioLoadRetry");
      }

      // Export the synthesized audio of a message as a downloadable file. Uses
      // the same in-session cache so a just-read message downloads instantly.
      // Long RVC/Index chunked reads have no single audio file yet -> unsupported.
      async function downloadText(rawText, onError) {
        const plain = plainText(rawText);
        if (!plain) return;
        // Long RVC reads are chunked with no single output file yet; skip rather
        // than starting a wasteful probe+prewarm conversion job on the Host.
        if ((shared.provider === "rvc" || shared.provider === "index-tts2") && plain.length > 60) {
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
            a.download = shared.provider === "index-tts2" ? "dsh-tts.wav" : "dsh-tts.mp3";
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
        ".dsh-tts-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:3000;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 32px));padding:9px 10px 9px 14px;border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 4px 18px rgba(0,0,0,.32);animation:dsh-tts-toast-in .18s ease-out}" +
        ".dsh-tts-toast-error{border-color:var(--dsw-alias-label-error)}" +
        ".dsh-tts-toast-warn{border-color:var(--dsw-alias-label-warning,var(--dsw-alias-label-secondary))}" +
        ".dsh-tts-toast-text{flex:1;min-width:0;white-space:pre-line;color:var(--dsw-alias-label-primary)}" +
        ".dsh-tts-toast-action{flex:none;height:26px;padding:0 11px;border:none;border-radius:999px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-inverse);font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap}" +
        ".dsh-tts-toast-action:hover{opacity:.88}" +
        ".dsh-tts-toast-close{flex:none;width:24px;height:24px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;line-height:1}" +
        ".dsh-tts-toast-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
        "@keyframes dsh-tts-toast-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}" +
        ".dsh-tts-fallback-row{display:flex;flex-direction:column;gap:4px;margin:2px 0 8px}" +
        ".dsh-tts-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none}" +
        ".dsh-tts-check input{accent-color:var(--dsw-alias-brand-primary);width:15px;height:15px;cursor:pointer}" +
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
        ".dsh-tts-footnote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:10px 4px 4px}" +
        /* ---- reading focus overlay ---- */
        ".dsh-tts-reading-overlay{position:fixed;right:16px;top:50%;transform:translateY(-50%);z-index:100;display:flex;flex-direction:column;align-items:flex-end;gap:4px;opacity:0;transition:opacity .45s cubic-bezier(.4,0,.2,1);pointer-events:none}" +
        ".dsh-tts-reading-overlay[data-visible]{opacity:1}" +
        ".dsh-tts-reading-bar{display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 3px 16px rgba(0,0,0,.22),0 0 30px rgba(0,0,0,.08);font-size:12px;line-height:1;color:var(--dsw-alias-label-primary);white-space:nowrap;transition:transform .35s cubic-bezier(.4,0,.2,1),opacity .35s ease;transform:translateX(12px);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:none;cursor:pointer}" +
        ".dsh-tts-reading-overlay[data-visible] .dsh-tts-reading-bar{transform:translateX(0);pointer-events:auto}" +
        ".dsh-tts-reading-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;animation:dsh-tts-rpulse 1.6s ease-in-out infinite;box-shadow:0 0 6px var(--dsw-alias-brand-primary)}" +
        "@keyframes dsh-tts-rpulse{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1.15)}}" +
        ".dsh-tts-reading-label{font-weight:600;font-variant-numeric:tabular-nums}" +
        ".dsh-tts-reading-preview{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:3px;padding:3px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 2px 10px rgba(0,0,0,.12);opacity:0;transition:opacity .4s ease .1s,transform .4s cubic-bezier(.4,0,.2,1) .1s;transform:translateY(4px)}" +
        ".dsh-tts-reading-overlay[data-visible] .dsh-tts-reading-preview{opacity:1;transform:translateY(0)}" +
        ".dsh-tts-reading-preview:empty{display:none}" +
        /* ---- sentence highlight: disabled (box-shadow projection removed) ----
           The highlight classes are kept as no-ops so any stale DOM class from
           an older bundle stays visually harmless. */
        /* pause state: stop dot animation */
        ".dsh-tts-reading-bar[data-paused] .dsh-tts-reading-dot{animation:none;opacity:.4}" +
        ".dsh-tts-reading-bar{cursor:pointer;transition:transform .15s ease}" +
        ".dsh-tts-reading-bar:hover{transform:translateX(0) scale(1.03)}";

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

      // ---------- toast host (transient notifications in shell.overlay) ----------
      function TtsToastHost() {
        useI18n();
        useSharedForce();
        const toast = shared.toast;
        if (!toast) return null;
        const node = react.createElement(
          "div",
          { className: "dsh-tts-toast dsh-tts-toast-" + toast.kind, role: "alert" },
          react.createElement("span", { className: "dsh-tts-toast-text" }, toast.text),
          toast.action
            ? react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-toast-action",
                  onClick: () => {
                    const fn = toast.action.onClick;
                    dismissToast();
                    if (typeof fn === "function") fn();
                  },
                },
                toast.action.label,
              )
            : null,
          react.createElement(
            "button",
            {
              type: "button",
              className: "dsh-tts-toast-close",
              "aria-label": t("toast.dismiss"),
              onClick: dismissToast,
            },
            "✕",
          ),
        );
        return node;
      }
      slots.inject("shell.overlay", () =>
        slots.register(
          { name: "shell.overlay", key: "tts-toast-host", id: "tts-toast-host", order: 1001 },
          TtsToastHost,
        ),
      );

      // ---------- approval alert poller (invisible, in shell.overlay) ----------
      // Polls /dsh-tts-api/notify?s=N every few seconds for new approval events
      // and announces them aloud. The first successful poll only syncs the
      // cursor (baseline) so a refresh doesn't replay stale alerts.
      function TtsNotifyPoller() {
        react.useEffect(() => {
          let alive = true;
          let timer = null;
          const poll = async () => {
            try {
              const r = await fetch(
                "/dsh-tts-api/notify?s=" + shared.notifyCursor,
              );
              const d = await r.json().catch(() => null);
              if (!alive || !d || !Array.isArray(d.items)) return;
              const latest = Number(d.latest) || shared.notifyCursor;
              if (!shared.notifyBaselined) {
                shared.notifyBaselined = true;
                shared.notifyCursor = Math.max(shared.notifyCursor, latest);
                return;
              }
              shared.notifyCursor = Math.max(shared.notifyCursor, latest);
              if (!d.items.length) return;
              for (const item of d.items) {
                try {
                  announceNotify(item);
                } catch (e) { /* one bad item must not stop the loop */ }
              }
            } catch (e) { /* poll again later */ }
          };
          timer = setInterval(poll, 4000);
          poll();
          return () => {
            alive = false;
            if (timer) clearInterval(timer);
          };
        }, []);
        return null;
      }
      slots.inject("shell.overlay", () =>
        slots.register(
          { name: "shell.overlay", key: "tts-notify-poller", id: "tts-notify-poller", order: 1002 },
          TtsNotifyPoller,
        ),
      );

      // ---------- reading focus overlay (vertical-center floating indicator) ----------
      // Shared helper for scroll-to-centre. (The old box-shadow sentence
      // highlight was removed as ugly; _ttsClearHighlight only sweeps stale
      // classes left by older bundles.)
      let _ttsHighlightedEl = null;
      function _ttsClearHighlight() {
        if (_ttsHighlightedEl) {
          try {
            _ttsHighlightedEl.classList.remove("dsh-tts-sentence-active");
            _ttsHighlightedEl.classList.remove("dsh-tts-sentence-prev");
          } catch (e) {}
          _ttsHighlightedEl = null;
        }
        // Sweep any highlight class an older bundle may have left behind.
        try {
          const stale = document.querySelectorAll(".dsh-tts-sentence-active,.dsh-tts-sentence-prev");
          for (const el of stale) {
            try {
              el.classList.remove("dsh-tts-sentence-active");
              el.classList.remove("dsh-tts-sentence-prev");
            } catch (e) {}
          }
        } catch (e) {}
      }
      function _ttsFindScrollContainer() {
        try {
          const sels = [
            '[class*="conversation"]', '[class*="messages"]',
            '[class*="chat-scroll"]', '[class*="_scroll"]',
          ];
          for (const sel of sels) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              const s = getComputedStyle(el);
              if (s.overflow === "auto" || s.overflow === "scroll" ||
                  s.overflowY === "auto" || s.overflowY === "scroll") {
                return el;
              }
            }
          }
        } catch (e) {}
        return null;
      }
      // Shows a small floating bar at the right edge, vertically centered, with a
      // pulsing dot, paragraph counter, and text preview. Fades in/out smoothly with
      // CSS transitions so it never feels jarring. Also tries to scroll the
      // conversation to keep the current reading paragraph visible.
      function TtsReadingOverlay() {
        useI18n();
        useSharedForce();
        const speaking = shared.speaking;
        const readingIdx = shared.readingIndex;
        const cp = shared.chunkProgress;
        const visible = shared.showReadingOverlay && speaking && readingIdx != null && cp && cp.total >= 1;
        // Compact bar: progress counter lives in the tooltip (title), not in
        // the bar text, so the bar stays narrow and never covers the host UI.
        const tip = shared.paused ? t("mini.resume")
          : (t("mini.pause") + (cp && cp.total > 1 ? " · " + (readingIdx || 0) + "/" + cp.total : ""));

        // --- Scroll-follow: track live playback position ---
        // Progress signal: single-file reads use audioEl.currentTime/duration
        // (real position); chunked reads interpolate inside the current chunk
        // by elapsed time (chunk length estimated from text length at ~3.6
        // CJK chars/s, same heuristic as the server). Result is a continuous
        // 0..1 ratio over the whole text, so the view glides instead of
        // jumping per chunk. User scrolls yield: any manual scroll pauses
        // follow for 5s so we never drag the view out of the user's hands.
        const ttsUserScrollAt = { t: 0 };
        // While true, scroll events come from our own scrollTo(), not the user.
        const ttsSelfScroll = { on: false };
        const ttsEstimateSec = (text) => {
          let cjk = 0, latin = 0, other = 0;
          const s = String(text || "");
          for (const ch of s) {
            const cp = ch.codePointAt(0);
            if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
            else if (/[A-Za-z0-9]/.test(ch)) latin++;
            else other++;
          }
          return Math.max(1, cjk / 3.6 + latin / 12 + other / 4);
        };
        const ttsLiveRatio = () => {
          const progress = shared.chunkProgress;
          if (!shared.speaking || !progress || !progress.total) return null;
          const total = progress.total;
          const idx = Math.min(Math.max(shared.readingIndex || 1, 1), total);
          // Single audio element with known duration: exact position.
          try {
            const el = shared.audioEl;
            if (el && el.duration && isFinite(el.duration) && el.duration > 0 &&
                total <= 1 && typeof el.currentTime === "number") {
              const r = el.currentTime / el.duration;
              if (isFinite(r) && r >= 0) return Math.min(1, r);
            }
          } catch (e) {}
          // Chunked: completed chunks + elapsed fraction of current chunk.
          const fullText = shared.currentText || "";
          const perChunk = ttsEstimateSec(fullText.slice(
            Math.floor(fullText.length * (idx - 1) / total),
            Math.floor(fullText.length * idx / total))) ||
            ttsEstimateSec(fullText) / total;
          const elapsed = Math.max(0, (Date.now() - (shared.chunkStartedAt || Date.now())) / 1000);
          const frac = Math.min(1, elapsed / Math.max(1, perChunk));
          return Math.min(1, ((idx - 1) + frac) / total);
        };
        const keepVisible = () => {
          const diag = window.__dshTtsFollowDiag || (window.__dshTtsFollowDiag = { calls: 0, last: "init", byReason: {} });
          const mark = (r) => {
            diag.calls++;
            diag.last = r;
            diag.byReason[r] = (diag.byReason[r] || 0) + 1;
          };
          if (!shared.showScrollFollow || !shared.speaking) { mark("off-or-idle"); return false; }
          // Yield to the user for 5s after any manual scroll.
          if (Date.now() - ttsUserScrollAt.t < 5000) { mark("user-yield"); return false; }
          if (shared.paused) { mark("paused"); return false; } // paused: hold still, don't drift
          const ratio = ttsLiveRatio();
          if (ratio == null) { mark("no-ratio"); return false; }
          diag.ratio = ratio;
          try {
            const scrollEl = _ttsFindScrollContainer();
            if (!scrollEl) { mark("no-container"); return false; }

            // Prefer the anchored message element (climbed from the read-aloud
            // button at click time). Whole-page text search is only a fallback
            // — it used to land on 24px fragments and scroll to wrong offsets.
            let msgEl = null;
            try {
              msgEl = shared.readingMsgEl ? shared.readingMsgEl.deref() : null;
              if (msgEl && !msgEl.isConnected) { msgEl = null; shared.readingMsgEl = null; }
            } catch (e) { msgEl = null; }
            if (!msgEl && shared.readingMsgKey) {
              // Re-locate by fingerprint: the anchored node was detached by a
              // host re-render. Search DIRECT children of the scroll container
              // only (message roots), skipping our own overlay nodes, matching
              // head text + approximate length. Cheap: children count is small.
              try {
                const key = shared.readingMsgKey;
                const kids = scrollEl.children;
                for (let i = 0; i < kids.length; i++) {
                  const el = kids[i];
                  if (!el || !el.classList) continue;
                  if (el.className && /dsh-tts/.test(String(el.className))) continue;
                  let t = "";
                  try { t = ((el.innerText || el.textContent) || "").trim().replace(/\s+/g, " "); } catch (e) {}
                  if (!t || t.length < 100) continue;
                  // Must have a real box: skip display:contents wrappers.
                  let h = 0;
                  try { h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0; } catch (e) {}
                  if (h < 60) continue;
                  if (key.head && t.slice(0, 40) === key.head &&
                      Math.abs(t.length - key.len) < Math.max(200, key.len * 0.3)) {
                    msgEl = el;
                    try { if (typeof WeakRef !== "undefined") shared.readingMsgEl = new WeakRef(el); } catch (e) {}
                    mark("relocated");
                    break;
                  }
                }
              } catch (e) {}
            }
            if (!msgEl) {
            // Find the message block being read. The needle tracks the LIVE
            // playback position (not the fixed text head): slice text around
            // ratio so long reads locate the current paragraph, not the first
            // one forever (that froze follow at the initial spot).
            const fullNeedle = shared.currentText || "";
            if (!fullNeedle) { mark("no-needle"); return false; }
            const pos = Math.floor(fullNeedle.length * Math.min(0.99, Math.max(0, ratio)));
            const needle = fullNeedle.slice(Math.max(0, pos - 50), pos + 50);
            if (!needle) { mark("no-needle"); return false; }

            const sels = [
              "[class*='message']", "[class*='msg']", "[data-message-id]",
              "p", "article", "section",
            ];
            for (const sel of sels) {
              const els = scrollEl.querySelectorAll(sel);
              for (const el of els) {
                const t = (el.innerText || el.textContent || "").trim();
                if (t && t.length > 20 && t.includes(needle.slice(0, 30))) {
                  msgEl = el; break;
                }
              }
              if (msgEl) break;
            }
            if (!msgEl) {
              const walker = document.createTreeWalker(scrollEl, NodeFilter.SHOW_ELEMENT);
              let n;
              while ((n = walker.nextNode())) {
                try {
                  const t = (n.innerText || n.textContent || "").trim();
                  if (t && t.includes(needle.slice(0, 30))) { msgEl = n; break; }
                } catch (e) {}
              }
            }
            if (!msgEl) { mark("no-msgEl"); return false; }
            } else { mark("anchored"); }
            // Cache text-resolved anchors: once a lookup finds a sane-size
            // element, reuse it (covers auto-read which has no click anchor).
            // Sanity: must be big enough to be a message, not a line.
            try {
              const h = msgEl.getBoundingClientRect ? msgEl.getBoundingClientRect().height : 0;
              if (h > 60 && typeof WeakRef !== "undefined") shared.readingMsgEl = new WeakRef(msgEl);
            } catch (e) {}

            // Live proportional target: glides through the message as audio plays
            const containerRect = scrollEl.getBoundingClientRect();
            const msgRect = msgEl.getBoundingClientRect();
            const msgTop = msgRect.top - containerRect.top + scrollEl.scrollTop;
            const msgHeight = msgRect.height;
            // Wrong-element guard (screen space!): skip only when the element
            // is clearly a fragment — shorter than two lines, or nowhere near
            // the viewport at all. NOTE msgTop is document coords; compare via
            // rect delta instead (comparing msgTop against scrollTop wrongly
            // rejected every tall message and froze follow completely).
            const relTop = msgRect.top - containerRect.top;
            const relBottom = msgRect.bottom - containerRect.top;
            if (msgHeight < 40 || relBottom < -containerRect.height * 3 ||
                relTop > containerRect.height * 3) {
              mark("bad-target");
              diag.guard = {
                h: Math.round(msgHeight),
                scrollH: msgEl.scrollHeight || 0,
                relTop: Math.round(relTop),
                relBottom: Math.round(relBottom),
                contH: Math.round(containerRect.height),
                tag: (msgEl.tagName || "?") + "." + String(msgEl.className || "").slice(0, 60),
              };
              return false;
            }
            const targetY = msgTop + msgHeight * ratio;
            diag.targetY = Math.round(targetY);
            diag.msgH = Math.round(msgHeight);
            const viewTop = scrollEl.scrollTop;
            const viewBottom = viewTop + containerRect.height;
            diag.viewTop = Math.round(viewTop);
            // Deadband: nudge only when the live point leaves the central
            // 50% band; small steps (no smooth-animation pile-up) so the
            // view tracks instead of rubber-banding to a stale spot.
            const margin = containerRect.height * 0.25;
            if (targetY > viewTop + margin && targetY < viewBottom - margin) {
              mark("in-view"); // comfortably visible, leave it alone
              return true;
            }
            const scrollTo = targetY - containerRect.height / 2;
            // Skip tiny corrections (<24px) to avoid jitter from estimate wobble
            if (Math.abs(scrollTo - viewTop) < 24) { mark("tiny-skip"); return true; }

            // Mark self-induced scroll so onUserScroll doesn't treat our own
            // scrollTo() as a manual scroll (that froze follow forever: every
            // heartbeat refreshed the 5s yield window with its own scroll).
            ttsSelfScroll.on = true;
            try {
              scrollEl.scrollTo({ top: Math.max(0, scrollTo), behavior: "auto" });
            } finally {
              setTimeout(() => { ttsSelfScroll.on = false; }, 120);
            }
            mark("scrolled");
            return true;
          } catch (e) { mark("threw:" + String((e && e.message) || e).slice(0, 60)); return false; }
        };
        react.useEffect(() => {
          keepVisible();
        }, [speaking, readingIdx, cp && cp.index, shared.showScrollFollow]);
        // Live heartbeat: 4x/sec while speaking so the view tracks the
        // playback position continuously, not just on chunk changes.
        // Also records manual scrolls (user takes over for 5s).
        react.useEffect(() => {
          if (!speaking || !shared.showScrollFollow) return undefined;
          const scrollEl = _ttsFindScrollContainer();
          const onUserScroll = () => {
            if (ttsSelfScroll.on) return; // our own scrollTo(), not the user
            ttsUserScrollAt.t = Date.now();
          };
          try {
            if (scrollEl) scrollEl.addEventListener("scroll", onUserScroll, { passive: true });
          } catch (e) {}
          const timer = setInterval(keepVisible, 250);
          return () => {
            clearInterval(timer);
            try {
              if (scrollEl) scrollEl.removeEventListener("scroll", onUserScroll);
            } catch (e) {}
          };
        }, [speaking, shared.showScrollFollow]);

        // --- Sweep stale highlight classes (from older bundles) when idle ---
        react.useEffect(() => {
          if (!speaking) {
            const timer = setTimeout(_ttsClearHighlight, 350);
            return () => clearTimeout(timer);
          }
        }, [speaking]);

        // Click handler: toggle play/pause
        const onBarClick = (e) => {
          if (e) {
            try { if (typeof e.stopPropagation === "function") e.stopPropagation(); } catch (err) {}
            try { if (typeof e.preventDefault === "function") e.preventDefault(); } catch (err) {}
          }
          if (shared.speaking) togglePause();
        };

        return react.createElement(
          "div",
          {
            className: "dsh-tts-reading-overlay",
            "data-visible": visible || undefined,
          },
          react.createElement(
            "div",
            {
              className: "dsh-tts-reading-bar",
              "data-paused": shared.paused || undefined,
              onClick: onBarClick,
              title: tip,
            },
            react.createElement("span", { className: "dsh-tts-reading-dot" }),
            react.createElement(
              "span",
              { className: "dsh-tts-reading-label" },
              // Compact: plain "朗读中/已暂停" text only. The "n / total"
              // counter made the bar wide enough to cover the host's node
              // list on the right; progress still lives in the tooltip.
              shared.paused ? t("overlay.paused") : t("overlay.reading"),
            ),
          ),
        );
      }
      slots.inject("shell.overlay", () =>
        slots.register(
          { name: "shell.overlay", key: "tts-reading-overlay", id: "tts-reading-overlay", order: 1003 },
          TtsReadingOverlay,
        ),
      );

      // ---------- 1) input.left: auto-read toggle + watcher ----------
      // The watcher used to require props.session.nodes with exactly
      // {kind:"assistant", messageId, seq, blocks}. Hosts that pass the
      // session via useSession/sessionId (or a renamed node shape) left this
      // effect early-returning forever, so auto-read never fired while the
      // settings preview (session-free) kept working. Accept every shape.
      // Anti-misfire rules (history must NEVER auto-read):
      //  - session switch -> silent re-baseline (opening history is silent;
      //    only live growth in the CURRENT session may speak);
      //  - bulk growth (> SYNC_BULK_NEW text nodes at once) -> history sync
      //    (refresh/async fill), silent re-baseline. A live reply arrives as
      //    one text node per completion; only a tiny (<=3 msg) history
      //    async-filling right after a switch can still blip once.
      const SYNC_BULK_NEW = 3;
      // A user-side latch only counts once it has AGED: history hydration
      // delivers user-then-assistant renders milliseconds apart, while a live
      // exchange always spans the agent run (seconds). Same-render batches
      // stay silent (live causality makes them impossible; history fill does
      // exactly this).
      const USER_LATCH_AGE_MS = 2000;
      function AutoReadToggle(props) {
        useI18n();
        const [on, setOn] = react.useState(shared.autoRead);
        react.useEffect(
          () => () => {
            stopIfSource("auto");
          },
          [],
        );
        // Snapshots from every content hook the host provides (fixed order).
        // Real-host logs show useSession carries only queue state (no nodes);
        // the message history lives behind a conversation hook, so the watch
        // source is picked dynamically (first list with assistant text).
        const snaps = collectSnaps(props);
        const legacyNodes = pickNodes(props && props.session);
        const picked = pickAutoList(snaps) ||
          (legacyNodes ? { name: "props.session", nodes: legacyNodes } : null);
        const nodes = picked ? picked.nodes : null;
        // Union of every snapshot list: user-side observation must NOT depend
        // on the picked (assistant-text) list — a user-only render would
        // otherwise be skipped and its latch lost.
        const snapLists = [];
        for (const entry of snaps) {
          const nl = pickNodes(entry.snap);
          if (nl && nl.length) snapLists.push(nl);
        }
        const sessSnap = snaps.length ? snaps[0].snap : null;
        // Stable per-session key (no data-source suffix): the watch source
        // legitimately switches from "none" to a hook list as a fresh
        // conversation fills in, and the baseline must survive that switch.
        const key = (props && props.sessionId) ||
          (sessSnap && sessSnap.sessionId) || "default";
        logSlotPropsOnce("conversation.input.left", props, snaps);
        react.useEffect(() => {
          // Session switch (module-level, survives remounts): opening a
          // historical conversation must stay silent no matter what arrives.
          const switched = shared.lastWatchKey !== undefined &&
            shared.lastWatchKey !== key;
          shared.lastWatchKey = key;
          let maxSeq = -1;
          let newest = null;
          let fresh = 0;
          let userMax = -1;
          const prev = shared.lastSeqBySession.get(key);
          const prevUser = shared.userSeqSeen.get(key);
          // User-side observation runs over the UNION of snapshot lists so a
          // user-only render (picked list absent) still latches.
          for (const nl of snapLists) {
            let uidx = 0;
            for (const n of nl) {
              uidx++;
              if (!n || typeof n !== "object") continue;
              if (!isUserNode(n)) continue;
              const sq = nodeSeq(n);
              const rank = sq !== null ? sq : uidx;
              if (rank > userMax) userMax = rank;
            }
          }
          if (nodes) {
            let idx = 0;
            for (const n of nodes) {
              idx++;
              if (!n || typeof n !== "object") continue;
              if (!isAssistantNode(n)) continue;
              // Text-bearing nodes only: object-map stores (locations, call
              // records) may carry ids but no readable text; electing them as
              // "newest" would swallow real messages behind an empty cursor.
              const body = extractText(n);
              if (!body.trim()) continue;
              const sq = nodeSeq(n);
              const rank = sq !== null ? sq : idx;
              if (prev !== undefined && rank > prev) fresh++;
              if (rank > maxSeq) {
                maxSeq = rank;
                newest = n;
              }
            }
          }
          // Liveness latch, PERSISTENT per key (updated on EVERY render, even
          // silent ones): speech needs proof this session is alive in this
          // page lifetime. Feeders: (1) agent visibly working (running/queue/
          // pending/partial); (2) user-side growth, but only once AGED past
          // USER_LATCH_AGE_MS — history hydration bursts user-then-assistant
          // renders milliseconds apart, a live exchange always spans seconds.
          // First-sight user nodes only record (they may be history). Idle
          // histories opened after refresh/switch never latch and stay silent
          // at ANY size, including <= SYNC_BULK_NEW tiny ones.
          const now = Date.now();
          let lively = shared.livelySeen.get(key) === true;
          let livelySrc = lively ? (shared.livelySrc.get(key) || "latch") : "none";
          if (!lively) {
            for (const entry of snaps) {
              const s = entry.snap;
              if (!s || typeof s !== "object") continue;
              let hit = null;
              if (s.running === true) hit = "running";
              else if (Array.isArray(s.queue) && s.queue.length) hit = "queue";
              else if (Array.isArray(s.pendingSubmissions) && s.pendingSubmissions.length) hit = "pending";
              else if (Array.isArray(s.runningCalls) && s.runningCalls.length) hit = "calls";
              else if (s.partial !== undefined && s.partial !== null) hit = "partial";
              if (hit) {
                shared.livelySeen.set(key, true);
                shared.livelySrc.set(key, entry.name + ":" + hit);
                lively = true;
                livelySrc = entry.name + ":" + hit;
                break;
              }
            }
          }
          if (prevUser === undefined) shared.userSeqSeen.set(key, userMax);
          else if (userMax > prevUser) {
            shared.userSeqSeen.set(key, userMax);
            shared.userLatchAt.set(key, now);
          }
          if (!lively) {
            const uAt = shared.userLatchAt.get(key);
            if (uAt !== undefined && (now - uAt) >= USER_LATCH_AGE_MS) {
              lively = true;
              livelySrc = "user+" + (now - uAt) + "ms";
            }
          }
          if (switched || prev === undefined) {
            // New session key (switch, remount, or first sight incl. refresh):
            // record the baseline WITHOUT speaking so history never replays.
            // An empty session baselines at -1, so its very first live reply
            // (maxSeq > -1, same key, small growth, latched lively) WILL speak.
            shared.lastSeqBySession.set(key, maxSeq);
            return;
          }
          if (fresh > SYNC_BULK_NEW) {
            // Bulk fill after the baseline (refresh/async history load):
            // follow silently instead of reading the whole backlog aloud.
            shared.lastSeqBySession.set(key, maxSeq);
            return;
          }
          if (newest && maxSeq > prev) {
            shared.lastSeqBySession.set(key, maxSeq);
            if (shared.autoRead && lively) {
              const text = extractText(newest);
              if (text.trim()) {
                // Decision audit: pasted from the console this line alone
                // tells which feeder authorized the speech.
                try {
                  console.info("[tts] auto-read speak key=" + key +
                    " fresh=" + fresh + " src=" + livelySrc + " seq=" + maxSeq);
                } catch (e) {}
                speakText(text, "auto", msg =>
                  showToast(t("synthFail") + msg, "error"),
                );
              }
            }
          }
        });
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
      // Robust counterpart of the auto-read fix: the button used to resolve
      // text only via useSession(s => s.nodes) + kind/messageId/blocks. Any
      // host skew left plain === "" which forced `disabled` -> a permanently
      // grey, unclickable button (while preview/TTS itself was healthy). Now
      // the button resolves from direct props, any snapshot shape, and the
      // surrounding DOM, and stays clickable so a failure surfaces a toast
      // instead of a dead control.
      function ReadAloudButton(props) {
        useI18n();
        useSharedForce();
        const snaps = collectSnaps(props);
        logSlotPropsOnce("conversation.chat.assistant-actions", props, snaps);
        const raw = resolveMessageText(props, snaps);
        const btnRef = react.useRef(null);
        const [domText, setDomText] = react.useState("");
        react.useEffect(() => {
          if (raw && raw.trim()) return;
          let t = "";
          try {
            t = domTextForEl(btnRef.current);
          } catch (e) { t = ""; }
          if (t && t !== domText) setDomText(t);
        });
        const plain = plainText(raw) || plainText(domText);
        const resolveTarget = () => {
          if (plain) return plain;
          try {
            return plainText(domTextForEl(btnRef.current));
          } catch (e) { return ""; }
        };
        const isPlaying =
          shared.speaking && !!plain && shared.currentText === plain;
        const cp = shared.chunkProgress;
        const playingLabel = isPlaying
          ? cp && cp.total > 1
            ? t("stopRead.part.lead") + cp.index + "/" + cp.total + t("stopRead.part.tail", { total: cp.total })
            : t("stopRead")
          : t("readThisMessage");
        const onClick = () => {
          const target = resolveTarget();
          if (!target) {
            showToast(t("synthFail") + t("emptyText"), "error");
            return;
          }
          // Anchor the real message element: climb from the button to the
          // nearest ancestor holding the message text AND a real box.
          // (A bare DIV with display:contents has text but height 0 — the old
          // climb stopped there and follow guarded every tick as bad-target.)
          try {
            shared.readingMsgEl = null;
            shared.readingMsgKey = null;
            let el = btnRef.current ? btnRef.current.parentElement : null;
            let best = null;
            let depth = 0;
            const climbLog = [];
            while (el && depth < 10) {
              let len = 0;
              let h = 0;
              try { len = ((el.innerText || el.textContent) || "").trim().length; } catch (e) {}
              try { h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0; } catch (e) {}
              climbLog.push((el.tagName || "?") + "." + String(el.className || "").slice(0, 40) + " len=" + len + " h=" + Math.round(h));
              if (len > 100 && h > 60) best = el; // text + real box: message root
              if (len > Math.max(500, target.length * 0.6) && h > 60) break;
              el = el.parentElement;
              depth++;
            }
            try {
              window.__dshTtsClimbLog = { at: Date.now(), targetLen: target.length, layers: climbLog,
                anchored: best ? ((best.tagName || "?") + "." + String(best.className || "").slice(0, 40)) : null };
            } catch (e) {}
            if (best) {
              try { shared.readingMsgEl = new WeakRef(best); } catch (e) { shared.readingMsgEl = null; }
              // Fingerprint for re-location: host React re-renders detach the
              // anchored node, so follow re-finds it by text, not by reference.
              try {
                const bt = ((best.innerText || best.textContent) || "").trim().replace(/\s+/g, " ");
                shared.readingMsgKey = { head: bt.slice(0, 40), len: bt.length };
              } catch (e) {}
            }
          } catch (e) {}
          speakText(target, "manual", msg => {
            // In RVC/Index mode offer one-click "read with Edge instead" — always
            // available, independent of the opt-in auto-fallback toggle.
            const action =
              shared.provider === "rvc" || shared.provider === "index-tts2"
                ? {
                    label: t("toast.useEdge"),
                    onClick: () =>
                      speakText(target, "manual", null, { provider: "edge-tts" }),
                  }
                : null;
            showToast(t("synthFail") + msg, "error", action);
          });
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
          const target = resolveTarget();
          if (!target) {
            onDlError(t("emptyText"));
            return;
          }
          downloadText(target, onDlError);
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
        // NOTE: no `disabled` here on purpose. An empty lookup used to freeze
        // the button grey and unclickable with zero feedback; now a click
        // re-resolves (props + DOM) and toasts when there is truly no text.
        return react.createElement(
          "div",
          { className: "dsh-tts-mini", ref: btnRef },
          ...controls,
          react.createElement(
            "button",
            {
              type: "button",
              className: "dsh-tts-action dsh-tts-action-dl",
              "aria-label": t("download.audio"),
              "data-tts-tip": t("download.audio"),
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
          // speakText already reports every real failure through onError with
          // the raw message (or voice.removed); the returned promise only
          // resets the preview state here (avoiding double-display).
          speakText(target, "manual", msg =>
            showError(t("synthFail") + msg),
          ).then(r => {
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
          if (HOST_RVC_KEYS.indexOf(key) >= 0) {
            const patch = {};
            patch[key] = value;
            pushHostRvc(patch);
          }
          setRvcTick(n => n + 1);
        };
        // ---- 本地 Index-TTS2（参考音频音色）----
        const [, setIndexTick] = react.useState(0);
        const setIndex = (key, value) => {
          shared.index[key] = value;
          saveSettings();
          if (HOST_INDEX_KEYS.indexOf(key) >= 0) {
            const patch = {};
            patch[key] = value;
            pushHostIndex(patch);
          }
          setIndexTick(n => n + 1);
        };
        const [indexVoices, setIndexVoices] = react.useState({ loading: false, error: null, list: [] });
        const refreshIndexVoices = async () => {
          setIndexVoices({ loading: true, error: null, list: [] });
          try {
            const r = await fetch(
              "/dsh-tts-api/index-voices?baseUrl=" + encodeURIComponent(shared.index.baseUrl),
            );
            const data = await r.json().catch(() => null);
            if (!r.ok || !data || data.error) {
              throw new Error(hostErrText(data) || ("HTTP " + r.status));
            }
            const list = Array.isArray(data.voices) ? data.voices : [];
            setIndexVoices({ loading: false, error: null, list });
            // auto-select the first voice when nothing is chosen yet
            if (!shared.index.voice && list.length) setIndex("voice", list[0]);
            else setIndexTick(n => n + 1);
          } catch (e) {
            setIndexVoices({
              loading: false,
              error: t("index.voices.fail") + String((e && e.message) || e),
              list: [],
            });
          }
        };
        const [indexUpload, setIndexUpload] = react.useState(null); // { busy, error, ok }
        const uploadIndexVoice = async file => {
          if (!file) return;
          setIndexUpload({ busy: true, error: null, ok: null });
          try {
            const buf = await file.arrayBuffer();
            let binary = "";
            const bytes = new Uint8Array(buf);
            const CHUNK = 32768;
            for (let i = 0; i < bytes.length; i += CHUNK) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            }
            const r = await fetch("/dsh-tts-api/index-upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baseUrl: shared.index.baseUrl,
                filename: file.name,
                audioBase64: btoa(binary),
              }),
            });
            const data = await r.json().catch(() => null);
            if (!r.ok || !data || data.error) {
              throw new Error(hostErrText(data) || ("HTTP " + r.status));
            }
            const name = data.filename || file.name;
            setIndexUpload({ busy: false, error: null, ok: t("index.upload.ok") + name });
            await refreshIndexVoices();
            if (name) setIndex("voice", name);
          } catch (e) {
            setIndexUpload({ busy: false, error: t("index.upload.fail") + String((e && e.message) || e), ok: null });
          }
        };
        // entering the Index-TTS2 provider auto-loads the voice list once
        react.useEffect(() => {
          if (provider === "index-tts2" && !indexVoices.loading && !indexVoices.list.length && !indexVoices.error) {
            refreshIndexVoices();
          }
        }, [provider]);
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
        // ---- 一键诊断（Edge 合成 / RVC 服务 / Index-TTS2 服务）----
        const [diag, setDiag] = react.useState(null); // { running, checks, error }
        const runDiagnose = async () => {
          setDiag({ running: true, checks: null, error: null });
          try {
            const r = await fetch("/dsh-tts-api/diagnose", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rvcBaseUrl: shared.rvc.baseUrl, indexBaseUrl: shared.index.baseUrl }),
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
        const indexTextIn = (key, placeholder) =>
          react.createElement("input", {
            className: "dsh-tts-rvc-input",
            value: shared.index[key],
            placeholder: placeholder,
            onChange: e => setIndex(key, e.target.value),
          });
        const indexNum = (key, step, min) =>
          react.createElement("input", {
            className: "dsh-tts-rvc-input dsh-tts-rvc-input-num",
            type: "number",
            step: step,
            min: min,
            value: shared.index[key],
            onChange: e => setIndex(key, Number(e.target.value)),
          });
        const indexSel = (key, options) =>
          react.createElement(
            "select",
            {
              className: "dsh-tts-rvc-input dsh-tts-select",
              value: shared.index[key],
              onChange: e => setIndex(key, e.target.value),
            },
            options.map(o =>
              react.createElement("option", { key: o[0], value: o[0] }, o[1]),
            ),
          );
        const indexSelNum = (key, options) =>
          react.createElement(
            "select",
            {
              className: "dsh-tts-rvc-input dsh-tts-select",
              value: shared.index[key],
              onChange: e => setIndex(key, Number(e.target.value)),
            },
            options.map(o =>
              react.createElement("option", { key: o[0], value: o[0] }, o[1]),
            ),
          );
        const indexSlider = (key, min, max, step, fmt) =>
          react.createElement(
            "div",
            { className: "dsh-tts-slider" },
            react.createElement("input", {
              type: "range",
              min: min,
              max: max,
              step: step,
              value: shared.index[key],
              onChange: e => setIndex(key, Number(e.target.value)),
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
                fmt(shared.index[key]),
              ),
            ),
          );
        const EMO_OPTIONS = [
          [0, t("index.emo.0")],
          [1, t("index.emo.1")],
          [2, t("index.emo.2")],
          [3, t("index.emo.3")],
        ];
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
            { className: "dsh-tts-fallback-row" },
            react.createElement(
              "label",
              { className: "dsh-tts-check" },
              react.createElement("input", {
                type: "checkbox",
                checked: shared.rvcAutoFallback,
                onChange: e => {
                  shared.rvcAutoFallback = e.target.checked;
                  saveSettings();
                  notify();
                },
              }),
              react.createElement("span", null, t("rvc.fallbackOn")),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              t("rvc.fallbackTip"),
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
            t("field.baseVoice"),
            sel("baseVoice", BASE_VOICES),
            t("field.baseVoice.tip"),
          ),
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

        const indexField = (label, control, note) =>
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
        const indexSection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack dsh-tts-rvc" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              t("section.index"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              t("index.desc"),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-onboard" },
            react.createElement(
              "div",
              { className: "dsh-tts-onboard-title" },
              t("index.onboard.title"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-onboard-desc" },
              t("index.onboard.desc"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-onboard-steps" },
              t("index.onboard.steps"),
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
          indexField(
            t("index.field.baseUrl"),
            indexTextIn("baseUrl", "http://127.0.0.1:7880"),
            t("index.field.baseUrl.tip"),
          ),
          indexField(
            t("index.field.voice"),
            react.createElement(
              "div",
              { className: "dsh-tts-path" },
              indexVoices.list.length
                ? react.createElement(
                    "select",
                    {
                      className: "dsh-tts-rvc-input dsh-tts-select",
                      value: shared.index.voice,
                      onChange: e => setIndex("voice", e.target.value),
                    },
                    react.createElement("option", { key: "", value: "" }, "—"),
                    indexVoices.list.map(v =>
                      react.createElement("option", { key: v, value: v }, v),
                    ),
                  )
                : indexTextIn("voice", "xxx.wav"),
              react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-tts-browse",
                  onClick: refreshIndexVoices,
                  disabled: !!indexVoices.loading,
                },
                indexVoices.loading ? t("index.refreshing") : t("index.refresh"),
              ),
            ),
            indexVoices.error
              ? react.createElement(
                  "div",
                  { className: "dsh-tts-error" },
                  indexVoices.error,
                )
              : (!indexVoices.loading && !indexVoices.list.length
                  ? t("index.voices.none")
                  : t("index.field.voice.tip")),
          ),
          indexField(
            t("index.upload"),
            react.createElement(
              "div",
              { className: "dsh-tts-path" },
              react.createElement("input", {
                type: "file",
                accept: ".wav,.mp3,.flac,.m4a,.ogg,audio/*",
                disabled: !!(indexUpload && indexUpload.busy),
                onChange: e => {
                  const f = e.target.files && e.target.files[0];
                  if (f) uploadIndexVoice(f);
                  try { e.target.value = ""; } catch (err) {}
                },
              }),
              (indexUpload && indexUpload.busy)
                ? react.createElement("span", { className: "dsh-tts-compact-info" }, t("index.uploading"))
                : null,
            ),
            (indexUpload && (indexUpload.error || indexUpload.ok))
              ? react.createElement(
                  "div",
                  { className: indexUpload.error ? "dsh-tts-error" : "dsh-tts-compact-info dsh-tts-compact-ok" },
                  indexUpload.error || indexUpload.ok,
                )
              : t("index.upload.tip"),
          ),
          indexField(
            t("index.cleanText"),
            react.createElement(
              "label",
              { className: "dsh-tts-check" },
              react.createElement("input", {
                type: "checkbox",
                checked: !!shared.index.cleanText,
                onChange: e => setIndex("cleanText", e.target.checked),
              }),
              react.createElement("span", null, t("index.cleanText")),
            ),
            t("index.cleanText.tip"),
          ),
          indexField(
            t("index.emo.method"),
            indexSelNum("emoControlMethod", EMO_OPTIONS),
            t("index.emo.method.tip"),
          ),
          shared.index.emoControlMethod === 1
            ? indexField(
                t("index.emo.ref"),
                indexTextIn("emoRefPath", "emotion.wav"),
                t("index.emo.ref.tip"),
              )
            : null,
          shared.index.emoControlMethod === 3
            ? indexField(
                t("index.emo.text"),
                indexTextIn("emoText", t("index.emo.text.tip")),
                t("index.emo.text.tip"),
              )
            : null,
          indexField(
            t("index.emo.weight"),
            indexSlider("emoWeight", 0, 1, 0.05, pctFmt),
            t("index.emo.weight.tip"),
          ),
          indexField(
            t("index.emo.random"),
            react.createElement(
              "label",
              { className: "dsh-tts-check" },
              react.createElement("input", {
                type: "checkbox",
                checked: !!shared.index.emoRandom,
                onChange: e => setIndex("emoRandom", e.target.checked),
              }),
              react.createElement("span", null, t("index.emo.random")),
            ),
            t("index.emo.random.tip"),
          ),
          react.createElement(
            "details",
            { className: "dsh-tts-advanced" },
            react.createElement("summary", null, t("section.advanced")),
            indexField(
              t("index.field.maxSeg"),
              indexNum("maxTextTokensPerSegment", 10, 20),
              t("index.field.maxSeg.tip"),
            ),
            indexField(
              t("index.field.temperature"),
              indexSlider("temperature", 0, 1.5, 0.05, v => String(v)),
              t("index.field.temperature.tip"),
            ),
            indexField(
              t("index.field.topP"),
              indexSlider("topP", 0, 1, 0.05, pctFmt),
              t("index.field.topP.tip"),
            ),
          ),
        );

        const overlaySection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              t("overlay.reading"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              t("overlay.showToggle.desc"),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-fallback-row" },
            react.createElement(
              "label",
              { className: "dsh-tts-check" },
              react.createElement("input", {
                type: "checkbox",
                checked: shared.showReadingOverlay,
                onChange: e => {
                  shared.showReadingOverlay = e.target.checked;
                  saveSettings();
                  notify();
                },
              }),
              react.createElement("span", null, t("overlay.showToggle")),
            ),
          ),
        );

        const scrollFollowSection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              t("scrollFollow.label"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              t("scrollFollow.desc"),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-fallback-row" },
            react.createElement(
              "label",
              { className: "dsh-tts-check" },
              react.createElement("input", {
                type: "checkbox",
                checked: shared.showScrollFollow,
                onChange: e => {
                  shared.showScrollFollow = e.target.checked;
                  saveSettings();
                  notify();
                },
              }),
              react.createElement("span", null, t("scrollFollow.label")),
            ),
          ),
        );

        const notifySection = react.createElement(
          "div",
          { className: "dsh-tts-module dsh-tts-module-stack" },
          react.createElement(
            "div",
            { className: "dsh-tts-module-info" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-title" },
              t("notify.title"),
            ),
            react.createElement(
              "div",
              { className: "dsh-tts-module-desc" },
              t("notify.desc"),
            ),
          ),
          react.createElement(
            "div",
            { className: "dsh-tts-fallback-row" },
            react.createElement(
              "label",
              { className: "dsh-tts-check" },
              react.createElement("input", {
                type: "checkbox",
                checked: shared.notify.enabled,
                onChange: e => {
                  shared.notify.enabled = e.target.checked;
                  saveSettings();
                  notify();
                },
              }),
              react.createElement("span", null, t("notify.enabled")),
            ),
          ),
          shared.notify.enabled
            ? react.createElement(
                "div",
                { className: "dsh-tts-fallback-row" },
                react.createElement(
                  "label",
                  { className: "dsh-tts-check" },
                  react.createElement("input", {
                    type: "checkbox",
                    checked: shared.notify.approval,
                    onChange: e => {
                      shared.notify.approval = e.target.checked;
                      saveSettings();
                      notify();
                    },
                  }),
                  react.createElement("span", null, t("notify.approval")),
                ),
                react.createElement(
                  "label",
                  { className: "dsh-tts-check" },
                  react.createElement("input", {
                    type: "checkbox",
                    checked: shared.notify.approvalResult,
                    onChange: e => {
                      shared.notify.approvalResult = e.target.checked;
                      saveSettings();
                      notify();
                    },
                  }),
                  react.createElement("span", null, t("notify.approvalResult")),
                ),
                react.createElement(
                  "div",
                  { className: "dsh-tts-rvc-row" },
                  react.createElement(
                    "span",
                    { className: "dsh-tts-rvc-label" },
                    t("notify.voice"),
                  ),
                  react.createElement(
                    "select",
                    {
                      className: "dsh-tts-select",
                      value: shared.notify.voice,
                      onChange: e => {
                        shared.notify.voice = e.target.value;
                        saveSettings();
                        notify();
                      },
                    },
                    VOICES
                      .filter(v => !shared.removedVoices.has(v[0]))
                      .map(v =>
                        react.createElement("option", { key: v[0], value: v[0] }, v[1]),
                      ),
                  ),
                ),
              )
            : null,
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
              react.createElement(
                "option",
                { value: "index-tts2" },
                t("provider.index"),
              ),
            ),
          ),
          overlaySection,
          scrollFollowSection,
          notifySection,
          react.createElement(
            "div",
            { className: "dsh-tts-module" },
            react.createElement(
              "div",
              { className: "dsh-tts-module-info" },
              react.createElement(
                "div",
                { className: "dsh-tts-module-title" },
                t("read.raw"),
              ),
              react.createElement(
                "div",
                { className: "dsh-tts-module-desc" },
                t("read.rawTip"),
              ),
            ),
            react.createElement(
              "label",
              { className: "dsh-tts-check" },
              react.createElement("input", {
                type: "checkbox",
                checked: !!shared.rawMarkdown,
                onChange: e => {
                  shared.rawMarkdown = e.target.checked;
                  saveSettings();
                  notify();
                },
              }),
              react.createElement("span", null, t("read.raw")),
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
          provider !== "rvc" && provider !== "index-tts2"
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
          provider === "index-tts2" ? null : soundSection,
          provider === "rvc" ? rvcSection : null,
          provider === "rvc" ? packSection() : null,
          provider === "index-tts2" ? indexSection : null,
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

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
