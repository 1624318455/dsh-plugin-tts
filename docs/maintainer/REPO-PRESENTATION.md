# 仓库展示维护手册（横幅 / About / Social preview）

改仓库「长相」的四件事，以及每件能自动化到什么程度。结论先放这里：
**前三件有 API，最后一件（Social preview）没有，只能走网页文件选择框。**

---

## 1. 素材：横幅卡片

| 文件 | 作用 |
|---|---|
| `assets/social-card.html` | 卡片源文件（1280×640 版式，浅色渐变 + 点阵网格 + 品牌蓝 `#2563EB`） |
| `assets/social-preview.png` | 渲染产物，2560×1280（2x），README 横幅与 Social preview 共用这一张 |
| `assets/voice-panel.png` | 右侧面板截图，从真机截图裁圆角、底部被弹窗自身滚动截断的半行已涂白 |

改文案后重渲（必须带 `--force-device-scale-factor=2`，否则 2x 会变成两倍尺寸的空画布）：

```sh
cd assets
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,640 \
  --screenshot=social-preview.png "file://$PWD/social-card.html"
```

`social-card.html` 里图片路径是相对的（`voice-panel.png`），因为 Chrome 的 `file://` 页面会按 HTML 所在目录解析。

**打包守卫**：`tests/pack-guard.mjs` 只校验 Markdown 里的**相对**链接是否指向打包文件。
README 横幅用的是绝对 raw URL，所以放 `assets/` 不会被白名单拦。

---

## 2. 仓库 About（描述 / 主页 / 话题）

```sh
gh api -X PATCH repos/1624318455/dsh-plugin-tts \
  -f description="Read DeepSeek Harness replies aloud — zero-config Edge TTS, local voice cloning when you want it. Gapless long reads." \
  -f homepage="https://www.npmjs.com/package/@memef1f1y/dsh-plugin-tts" \
  -F has_discussions=true

# 话题必须用专用接口，PATCH 里的 topics[] 不生效
gh api -X PUT repos/1624318455/dsh-plugin-tts/topics --input - <<'JSON'
{"names":["deepseek-harness","dsh-plugin","edge-tts","text-to-speech","tts",
          "rvc","voice-cloning","cosyvoice","gpt-sovits","index-tts"]}
JSON
```

描述控制在两行内，GitHub 侧栏约 3 行就会截断。当前 10 个话题是实测不被折叠的上限附近。

---

## 3. Social preview：唯一没有 API 的一项

已确认：REST、GraphQL、`gh repo edit` 都没有这个字段。入口只有
`https://github.com/<owner>/<repo>/settings` → **Social preview** → `Edit` → `Upload an image…`。

图要求 1280×640（建议），我们给的是 2560×1280 / 2x。

上传后**这样验证**，不要只看页面：

```sh
curl -s https://github.com/1624318455/dsh-plugin-tts | grep -o 'og:image" content="[^"]*"'
# 上传前：opengraph.githubassets.com/<hash>/<owner>/<repo>   ← GitHub 自动生成
# 上传后：repository-images.githubusercontent.com/<repoId>/<uuid>  ← 自己那张
curl -s -o /tmp/og.png -w "%{http_code} %{size_download}\n" "<上面的 URL>"
```

`repository-images.githubusercontent.com` + 200 + 2560×1280，三个条件同时成立才算生效。

### 自动化：能用的做法和坑

文件选择框是 macOS 原生窗口，网页侧的 CDP/扩展点击**完全够不到**。要自动化只有两条路：辅助功能（Accessibility）权限 + 合成键鼠事件。

现成工具留在 `~/.workbuddy/tools/`（依赖 WorkBuddy.app 的「隐私与安全性 → 辅助功能」授权）：

| 工具 | 用途 |
|---|---|
| `cuagent` | `probe` 查权限 / `click x y` / `key cmd shift 5` / `type <text>` |
| `axdump tree <depth>` | 导出前台窗口的 AX 树，人工找控件 |
| `axgo "<绝对路径>"` | 在已打开的「前往文件夹」输入框里 setValue + 聚焦 + 两次回车 |

流程与三个坑：

1. 页面上点 `Edit` → `Upload an image…`（这步可以用浏览器扩展点，坐标点击即可）。
2. 面板出来后发 ⌘⇧G（`cuagent key cmd shift 5`）。
3. **坑 1**：用 CGEvent 逐字注入路径不可靠，`NSOpenPanel` 的路径框会残留上一次的路径。必须用 AX `AXUIElementSetAttributeValue(kAXValue)` 直接赋值。
4. **坑 2**：只赋值不发焦点，回车会被文件列表吃掉。要同时设 `kAXFocusedAttribute = true`。
5. **坑 3**：回车要发**两次** —— 第一次关掉「前往文件夹」浮层并选中文件，第二次才等于点「打开」。

判定成功的信号是页面里 `Uploading…` 转圈变成图片预览，再走上面的 `og:image` 校验。
**不要**以「文件选择框消失了」当成功依据。

---

## 4. 两个不会自动刷新的地方

- **npm 页面上的 README**：取的是发布包内的 `README.md`，只有发新版本才更新。改完 README 想同步，就走一次纯文档版本（见 `CHANGELOG.md` 里 v0.7.5 的先例）。
- **社交平台的分享卡片**：Slack / X / 微信等会缓存 og 数据，换图后旧链接仍是旧卡，只有新链接才吃到新图。GitHub 自己的 `?` 缓存刷新入口没有，等平台过期即可。
