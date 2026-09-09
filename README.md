# NovelForge

NovelForge 是一款本地优先的中文长篇小说 Markdown 创作工作台，采用 Tauri 2、React、TypeScript、Rust 和 SQLite。

当前版本：**1.1.1-rc.3（预发布）**。

[![main CI](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)

## 下载

- [Windows x64 安装包](https://github.com/Gunanzhao/NovelForge/releases/download/v1.1.1-rc.3/NovelForge_1.1.1-rc.3_x64-setup.exe)
- [独立 EXE](https://github.com/Gunanzhao/NovelForge/releases/download/v1.1.1-rc.3/novelforge.exe)
- [SHA-256 校验文件](https://github.com/Gunanzhao/NovelForge/releases/download/v1.1.1-rc.3/SHA256SUMS.txt)
- [版本说明与历史 Release](https://github.com/Gunanzhao/NovelForge/releases)

已有安装版用户运行新安装包升级；直接运行独立 EXE 不会更新旧快捷方式。桌面版需要 Windows WebView2。

## 1.1.1-rc.3 相比 1.1.1-rc.2

- **正文选区显示**：使用浏览器原生文本选择，跨行及自动换行高亮贴合实际文字；浅色与深色分别设置选区背景和文字颜色。选中文本时隐藏当前行的整行底色，避免大面积矩形遮盖正文，普通界面和 F11 专注模式均适用。
- **AI 等待期间可继续操作**：兼容 Provider 请求在后台执行，不再阻塞窗口线程；等待模型响应时仍可编辑正文、切换页面和访问项目数据。
- **AI 空响应诊断**：区分输出上限耗尽、仅返回思考内容、服务拒绝、工具调用和无可用正文，结果区明确显示等待、失败与停止状态。支持字符串、文本分块及旧式文本响应；思考字段和开头的 `<think>` 内容不会作为正文应用。
- **输出上限恢复**：内置 Provider 任务因输出上限耗尽失败时，可手动提高 Max Tokens 并重试；按钮将上限提高至至少 4,096，之后按当前值翻倍，最高 32,000。也可打开连接设置自行调整，不会自动重发请求。
- **回归验证**：新增真实鼠标拖选验收和模拟慢速 Provider 的桌面响应检查，保留选区绑定、逐项接受、撤销重做和正文冲突保护。

本次在 rc.2 已有的正文 AI 侧栏、完整工作台、模板和 Codex 接入基础上修复交互与响应处理；[完整代码对比](https://github.com/Gunanzhao/NovelForge/compare/v1.1.1-rc.2...v1.1.1-rc.3)。

## 主要功能

- **正文写作**：作品／卷／章／节管理，Markdown 编辑、预览与分栏，自动保存、版本历史、章节锁定和全文搜索。
- **资料管理**：人物、地点、世界观、自定义字段、标签、附件及 `[[名称]]` Wiki 双向引用。
- **写作规划**：三级大纲、时间线、伏笔、剧情线、人物关系图、灵感箱和章节完成 Checklist。
- **辅助分析**：写作统计、人物出场统计、一致性检查、断链与关联提示。
- **名字生成器**：12 类名字、8 种风格，支持命名条件、家族与主题系列、项目避重、锁定、收藏、历史和专属词库。
- **AI 辅助**：正文右侧可直接续写、润色、改写、扩写、缩写和摘要，选区浮动工具栏、右键菜单及快捷键均可进入；与完整双栏工作台共享任务和结果，支持参考资料、Prompt 模板、修改对比、逐项接受和撤销重做。
- **导出与恢复**：Markdown、TXT、HTML、DOCX、EPUB、PDF 导出，回收站及整项目备份、校验和恢复。
- **工作区**：浅色／深色／跟随系统主题、专注模式、侧栏调整、快捷命令和未保存草稿保护。

## 开始使用

1. 创建项目时选择空目录，或打开已有 NovelForge 项目。
2. 在左侧建立卷、章或节，进入正文写作；人物、地点等资料可在对应页面维护。
3. 正文中使用 `[[人物名]]` 等引用关联资料；用写作规划、时间线和伏笔管理情节。
4. 正文工具栏点击“AI 辅助”，或选中文字后使用浮动工具栏／右键菜单。确认目标及参考资料，预览请求后运行，再审阅结果并决定是否应用。
5. 使用导出生成阅读文件，使用整项目备份保留正文、资料、附件和历史。

常用快捷键：`Ctrl+S` 保存，`Ctrl+P` 快速打开，`Ctrl+Shift+P`（兼容 `Ctrl+K`）打开命令面板，`Ctrl+Shift+I` 记录灵感，`Ctrl+0` 打开 AI 辅助。

## 正文内使用 AI

- 正文右栏可切换“章节信息 / AI 辅助”；窗口较窄或处于专注模式时使用抽屉。点击“完整工作台”可展开，任务、输入、结果及连接状态保持一致。收起面板或切换普通页面不会重复发送或中止生成。
- 润色、改写、扩写、缩写默认绑定进入时的选区；续写绑定原光标，默认参考光标前最多 4,000 字符；摘要默认参考整章。可以重新选择目标、勾选人物等资料或使用模板。打开面板、选择任务和预览均不会发送请求，只有运行时发送明确选中的上下文。
- 结果可复制、修改后应用或重新生成；选区修改提供“生成结果 / 修改对比”，可全部接受、逐项接受或保留原文。接受后通过编辑器 `Ctrl+Z` / `Ctrl+Y` 撤销、重做，审阅状态同步更新；已接受部分内容后结果文本锁定，避免后续改写覆盖已接受内容。
- 应用位置绑定本次原目标，移动光标不会改写新选区。目标之外的编辑会自动跟踪位置；与目标改动冲突时阻止覆盖，仍可接受其他无冲突项。整章替换需要确认，锁定章节不能写入。
- 切换章节会停止当前任务接收，旧结果不能写入另一章；切换项目会取消并清空任务。Codex 支持流式查看和停止生成；兼容 Provider 当前一次性返回，“停止接收”会忽略后续返回，但服务端可能仍继续处理。未完成结果只可查看与复制。

## AI 模式

### 本地离线

不需要 API Key，提供根据所选上下文组成的本地草稿。该模式不运行在线大模型。

### 兼容 Provider

在“连接设置”填写 OpenAI-compatible 服务的 Base URL、模型和可选 API Key。密钥只保留在当前窗口，不保存到项目或偏好。远程非加密 HTTP 地址会在发送前提示并要求确认。

等待期间可继续操作软件。若结果区提示“输出上限耗尽”，可手动提高上限重试，或在模型服务中降低思考量；提高上限可能增加耗时和服务用量。当前仍为一次性返回正文，“停止接收”仅忽略后续结果，不能保证服务端停止处理。

### Codex 订阅（实验性）

使用本机官方 Codex CLI 的 ChatGPT 登录和订阅额度，CLI 不随安装包分发。

1. 安装官方 CLI，在 AI 辅助顶部选择“Codex 订阅”，点击“检查连接 / 刷新登录”。
2. 程序会自动查找 CLI；在“连接设置”也可指定原生可执行文件，并查看真实路径、版本、登录、额度及兼容诊断。
3. 未登录时点击“登录 ChatGPT”，在浏览器完成官方登录后刷新。API Key 登录不会启用订阅生成。
4. 选择 CLI 返回的模型和推理强度，再选择写作任务或模板。模板运行前需确认最终 Prompt。

兼容验证基线为 **0.149.1 / 0.153.4**。新版本只有通过协议匹配、配置隔离及本地模拟行为验证才会启用；程序不自动安装、升级或降级 CLI。检查最长 90 秒，可取消或重新验证；成功缓存有效期七天，绑定 CLI、模型及配置指纹。

一次检查成功后，同一软件窗口内切换页面或 AI 模式再回来会保持连接状态；检查中离开页面继续执行。关闭窗口后清理内存状态，重新打开仍需检查。CLI、配置、模型和登录在生成前继续核验；取消检查或连接失效后不允许强制生成。

生成使用官方订阅服务、空工作目录和临时会话，关闭工具、MCP 和插件，不修改全局 Codex 配置，不自动回退至 API 计费。用户配置中无法可靠隔离的内容会阻止生成并给出原因。

额度与本机 Codex 账号共用，缺失额度信息不代表零额度。本地兼容检查不消耗订阅生成额度；真实生成会发送明确选中的内容并使用订阅额度。模拟验证通过不等于所有模型的真实订阅生成均已验收。

Codex 结果可以流式查看和停止生成；未完成文本只供查看与复制，目标内容冲突时阻止覆盖。生成请求不自动重发，也不会因切换界面重复发起。

## 数据安全

- 正文保存在项目 `manuscript/` 下的普通 Markdown 文件；数据库位于 `.novelforge/database.sqlite`，恢复副本位于 `.novelforge/recovery/`，版本历史位于 `.novelforge/history/`。
- 删除的项目内容先进入 `trash/`。建议使用整项目备份，保留数据库、正文、资料镜像、附件和历史，而不是只备份数据库。
- 资料镜像包含版本化 `novelforgeEntity` JSON 前置元数据及可读 Markdown。人工修改资料镜像时需保持两种表示一致；正文 Markdown 的常规编辑不受影响。
- 正文外部修改会触发冲突保护，读取失败会中止导出；恢复时检查路径边界，失败时报告回滚结果。
- 章节锁定用于防止误编辑，不等于加密或操作系统权限控制。
- Markdown 预览中的 HTTP/HTTPS 远程图片会向托管服务器请求资源。AI 预览包含 System 与 User 内容，前端合计上限为 80,000 字符，后端硬上限为 200,000 字符。

## 开发与构建

Windows 开发需要 Node.js 22 或更新版本、pnpm 11.19.0、Rust MSVC 工具链及 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm tauri:dev
```

检查与打包：

```powershell
pnpm typecheck
pnpm lint
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm tauri:build
```

Windows EXE 位于 `src-tauri/target/release/`，NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`。

桌面专项在构建后运行：

```powershell
node scripts/editor-ai-ui-cdp.mjs
node scripts/codex-compatibility-ui-cdp.mjs
node scripts/ai-workbench-ui-cdp.mjs
node scripts/editor-selection-ui-cdp.mjs
node scripts/provider-responsive-ui-cdp.mjs
```

这些检查使用独立合成项目和 WebView2 配置，截图与结果写入忽略的 `tmp/`。正文 AI 测试使用本机模拟 Provider，验证选区范围、共享任务、差异审阅、撤销重做、自动保存及浅／深色和窄窗口布局；Codex 测试只检查登录、兼容性和连接保持，不默认执行真实订阅生成。CI 包含前端、Rust 检查和 Windows CLI 兼容矩阵，实时结果见 [GitHub Actions](https://github.com/Gunanzhao/NovelForge/actions)。

插件扩展目前采用源码内显式注册的进程内 Registry，不从磁盘动态执行任意外部 JavaScript。
