# Live2D Virtual Partner

Windows 桌面宠物 / 虚拟伴侣：Live2D 模型常驻桌面，接入任意 OpenAI 兼容大模型进行对话，支持语音收发、情绪表情、长期记忆，以及通过 OneBot 接入 QQ。

> 当前版本 **1.1.0**：在 1.0.0 基础上完成一轮「表现力 + 记忆 + 生态 + 工程化」升级（分句流式 TTS、视线跟随、主动陪伴、语义记忆召回、多会话、世界书、全局热键、ESLint/CI 等），详见文末「版本升级」。

## 功能

- **桌面宠物**：透明、无边框、置顶、可穿透鼠标；气泡按住说话、拖动移动、托盘控制显隐；**视线跟随鼠标**、随机 idle 小动作；全局热键（`Ctrl+Alt+P`）快速唤出气泡。
- **Live2D**：Cubism 2/3/4 模型，支持 zip / 文件夹导入、缩略图、缩放与垂直偏移、口型同步、点击动作。
- **AI 对话**：任意 OpenAI 兼容端点（DeepSeek、通义、豆包、Kimi、OpenRouter…）或本地 Ollama / LM Studio / vLLM / llama.cpp；流式输出、随时中断、重新生成、温度/top_p/max tokens 可调；**支持多会话**（同一角色多个对话分支，上下文与记忆相互隔离）。
- **情绪表演**：模型按回复末尾的 `【情绪:开心】` 标签切换表情，可在角色面板里为每种情绪手动映射表情名。
- **长期记忆**：超出阈值后自动把旧对话压缩成结构化记忆（身份 / 偏好 / 约定 / 事件 / 事实），按重要度、时效与**当前话题语义**排序注入系统提示；聊天窗里可查看、手动记一笔、编辑、删除。
- **角色系统**：多角色，独立人格/开场白/音色/模型/表情映射；支持 SillyTavern 角色卡（PNG / JSON）导入导出（含**世界书**、备用开场白、标签），导入时自动提取头像；内置唯一预设角色「大肥鱼」（鲸鱼娘），可一键添加。
- **摄像头交互**：开启后 TA 通过摄像头「看到你」——实时视频（镜像自拍视角）、人脸位置追踪让头部 / 眼球跟随你，识别「出现 / 挥手 / 靠近 / 远离」等动作并做出表情与语音反馈；视频只在本地逐帧处理，**不上传**。
- **语音**：TTS 播报（带口型同步）+ STT 按住说话，兼容 `/v1/audio/speech` 与 `/v1/audio/transcriptions`；**分句流式播报**（回复边生成边按句合成播放，首字延迟大降）+ 输入/录音即打断；也可切换为 **Windows 本地引擎（SAPI）**，离线合成 / 识别。
- **主动陪伴**：开机说出开场白，长时间无人理时主动搭话（可配置闲置时长）；可在「关于」面板里开关。
- **QQ 接入**：OneBot v11 正向 WebSocket（NapCat、Lagrange、go-cqhttp 等），好友/群白名单、群聊仅 @ 回复、自动重连与心跳、串行回复队列；**每个好友/群聊的上下文与长期记忆相互隔离**，互不串扰；收到图片/表情/语音等消息会自然回应。
- **聊天窗**：桌面对话的历史记录、跨窗口同步的「回复中」状态、搜索过滤、导出 Markdown、复制、重新生成、错误留痕（QQ 会话消息在「QQ 面板 → 最近消息」查看，不进入桌面聊天窗）。
- **工程化**：主进程/渲染进程类型检查、Vitest 单测、ESLint + Prettier、GitHub Actions CI、CDP 冒烟测试、electron-builder 打包配置、日志文件、开机自启、全屏时自动隐藏。

## 环境要求

- Windows 10/11（x64）
- Node.js ≥ 20（开发用；打包后不需要）
- **Live2D Cubism Core（必须自行获取，因版权不可再分发）**
  - Cubism 3/4 模型：`live2dcubismcore.min.js`，从 [Live2D 官网](https://www.live2d.com/en/sdk/download/web/) 下载 Cubism SDK for Web 后取得
  - Cubism 2 模型：`live2d.min.js`（旧版 SDK / 社区镜像）

## 快速开始

```bash
npm install
npm run dev          # 开发模式（热更新）
npm run build        # 产出 out/
npm start            # 运行已构建版本
npm run dist         # 生成 Windows 安装包到 dist/
npm run dist:dir     # 只生成免安装目录，便于验证打包
```

> 若 Electron 二进制未下载成功，执行 `node node_modules/electron/install.js`（可先设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。

第一次启动后（默认没有角色，可新建 / 导入卡 / 一键添加预设「大肥鱼」）：

1. 托盘图标右键 → **设置** → **角色**：点「新建」创建角色，或「导入卡」导入 SillyTavern 角色卡，或点预设「大肥鱼」。
2. **模型**：点「选择 Cubism 3/4 Core」导入 `live2dcubismcore.min.js`（Cubism 2 同理）。
3. **模型** → 导入 zip 或文件夹 → 点「启用」。
4. **对话**：填 Base URL（如 `https://api.deepseek.com`，会自动补 `/v1`）与 API Key、模型名 → 「保存并测试连接」。
5. 可选：**语音** 配置 TTS/STT、**QQ** 配置 OneBot 地址、**关于** 打开开机自启。

## 目录与数据

| 位置 | 内容 |
| --- | --- |
| `out/` | 构建产物（`main` / `preload` / `renderer`） |
| `build/icon.png` | 应用与安装包图标 |
| `scripts/smoke.mjs` | CDP 冒烟测试脚本 |
| `%APPDATA%\live2d-virtual-partner\config.json` | 配置（API Key 经 DPAPI 加密，前缀 `enc:v1:`） |
| `%APPDATA%\live2d-virtual-partner\history\` | 每个作用域（桌面角色 + 各 QQ 会话）的对话与记忆，整份文件 DPAPI 加密（`enc:v1:` 前缀） |
| `%APPDATA%\live2d-virtual-partner\logs\main.log` | 主进程日志（>2MB 轮转为 `main.old.log`） |
| 默认模型库 | 若检测到旧版路径 `D:\Developer\AImodels\live2d-models` 则沿用，否则 `%APPDATA%\live2d-virtual-partner\models` |

模型库、Core 目录都可在设置里更换 / 打开。

## 开发说明

```
src/
├── main/            # 主进程：窗口、托盘、IPC、各 service
│   ├── services/    # endpoint / llm / tts / stt / history / memory / onebot / model / protocol / config
│   ├── windows/     # pet / chat / settings 窗口
│   └── index.ts     # 启动编排、单实例、CSP、日志
├── preload/         # contextBridge 暴露 window.api
├── shared/          # 主/渲染共享类型与默认值（单一契约来源）
└── renderer/
    ├── pet/         # 桌面宠物：PIXI + Live2D + 气泡
    ├── chat/        # 聊天记录窗口
    ├── settings/    # 设置窗口（6 个分页）
    └── shared/      # Pinia store、全局样式
tests/               # Vitest 单测（纯函数）
```

常用脚本：

```bash
npm run typecheck    # 主进程 tsc + 渲染进程 vue-tsc
npm run test         # Vitest 单测（端点归一化 / 情绪标签 / 导出）
npm run smoke        # 需先以 --remote-debugging-port=9333 启动应用
```

冒烟测试用法：

```bash
npm run build
node_modules\electron\dist\electron.exe . --remote-debugging-port=9333
npm run smoke        # 另开一个终端
```

## 安全设计

- 渲染进程：`sandbox: true` + `contextIsolation: true`，不开放 `nodeIntegration`。
- 自定义协议 `live2d://` 白名单映射（models / core / thumbnail / avatar），带路径穿越校验。
- 打包版本通过 `onHeadersReceived` 注入 CSP，**不允许 `unsafe-eval`**（PIXI 7 的着色器编译改走 `@pixi/unsafe-eval` 预编译方案）；外部导航与 `window.open` 一律拦截。
- API Key 落盘前用 `safeStorage`（Windows DPAPI）加密，仅主进程可解密。`config:get` 与配置广播一律下发脱敏占位符，明文仅设置窗口在编辑时通过 `getSecrets()` 显式获取，桌面宠物窗口不接触明文。
- AI/语音请求全部走主进程代理，避免 CORS 与 Key 泄漏。

## 常见问题

- **模型不显示 / 提示 Core 缺失**：确认 Cubism Core 已导入，路径见「关于 → 数据目录」；Cubism 2 模型需要 `live2d.min.js`。
- **对话 404**：Base URL 只要填到域名（`https://api.deepseek.com`）或带版本（`.../v1`）都可以，程序会自动补齐；若填了完整端点也能识别。
- **TTS 报 400**：部分服务不支持 `speed` / `response_format`，程序会自动用最小请求体重试一次。
- **QQ 连不上**：确认 OneBot 实现已启动并监听 `ws://127.0.0.1:3001`，OneBot 面板里能看到重连日志与状态。
- **托盘图标消失**：退出后重启即可；程序为单实例，重复启动会唤起已有窗口。

## 版本升级（1.1.0）

- 新增：分句流式 TTS（回复边生成边按句合成播放，首字延迟大幅降低）、输入/录音打断播报、视线跟随鼠标、随机 idle 小动作、主动陪伴（开机问候 + 闲置搭话，可配置）、长期记忆语义召回（话题关键词加权）、独立摘要模型配置、多会话（同一角色多个对话分支隔离）、SillyTavern 世界书/备用开场白/标签解析与 PNG 角色卡导出、QQ 图片/表情/语音消息回应、全局热键（`Ctrl+Alt+P`）。
- 升级：上下文裁剪改为 token 估算并扣除系统提示与记忆占用、记忆超限按重要度淘汰（不再误删高重要度旧记忆）、历史写盘防抖合并、TTS 落盘缓存、ESLint + Prettier + GitHub Actions CI。
- 修复：OneBot 字符串消息的 @ 判定误判、QQ 高频消息同步写盘阻塞。

## 版本升级（1.0.0）

- 修复：TTS/STT 端点重复 `/v1`、OneBot 用户消息重复入 prompt、断线不重连、无法中断生成、跨窗口并发、切换模型后 resize 监听泄漏、TTS MIME 硬编码、历史按条数裁剪、错误入历史、设置窗重复 `onMounted`、订阅不释放、模型库硬编码路径、zip-slip、托盘重建风暴、`process.exit` 跳过清理、空回复落库、`sandbox:false`、Key 明文、无 CSP、无日志、无类型检查等 37 项。
- 新增：情绪标签与表情映射、长期记忆压缩、流式 TTS 缓存、模型缩略图/缩放/偏移、角色卡导出与头像提取、多屏位置钳制、全屏自动隐藏、开机自启、日志轮转、冒烟测试、打包配置与图标。
- 升级：Electron 33 → 44（Node 20 → 24）、`ws` 显式依赖（Electron 主进程不再依赖实验性全局 WebSocket）、版本号 0.1.0 → 1.0.0。

## 已知限制

- 仅支持 Windows（安装包为 NSIS x64，未签名，首次运行可能触发 SmartScreen）。
- Cubism Core 需用户自行提供；Cubism 2 的兼容性取决于 `live2d.min.js` 版本。
- 暂无自动更新（需要代码签名证书与发布通道）与多语言界面。
- Live2D 渲染依赖第三方 patch fork `pixi-live2d-display-lipsyncpatch`，且绑定 PIXI 7（PIXI 8 不兼容），升级依赖时需同步评估。
- 历史/记忆的落盘加密基于 Windows DPAPI（`safeStorage`），仅当前 Windows 账户可解密。
- 本地语音（SAPI）依赖 Windows `System.Speech`：离线可用、免费，但音色偏机械、识别准确度低于云端模型；识别需要系统装有对应语言的语音识别（中文系统通常自带）。
- 摄像头交互的人脸/动作识别采用**本地肤色 + 运动启发式**（非深度学习模型）：完全离线、零依赖、隐私安全，但对光线敏感、挥手/靠近识别可能偶有误判；如需更高精度可后续接入 MediaPipe/face-api 等模型。
