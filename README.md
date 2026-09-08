# NovelForge

NovelForge 是一款本地优先的中文长篇小说 Markdown 创作工作台，采用 Tauri 2、React、TypeScript、Rust 和 SQLite。

当前版本：**1.1.1-rc.1（预发布）**。

[![main CI](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)

## 下载

- [Windows x64 安装包](https://github.com/Gunanzhao/NovelForge/releases/download/v1.1.1-rc.1/NovelForge_1.1.1-rc.1_x64-setup.exe)
- [独立 EXE](https://github.com/Gunanzhao/NovelForge/releases/download/v1.1.1-rc.1/novelforge.exe)
- [SHA-256 校验文件](https://github.com/Gunanzhao/NovelForge/releases/download/v1.1.1-rc.1/SHA256SUMS.txt)
- [版本说明与历史 Release](https://github.com/Gunanzhao/NovelForge/releases)

已有安装版用户运行新安装包升级；直接运行独立 EXE 不会更新旧快捷方式。桌面版需要 Windows WebView2。

## 主要功能

- **正文写作**：作品／卷／章／节管理，Markdown 编辑、预览与分栏，自动保存、版本历史、章节锁定和全文搜索。
- **资料管理**：人物、地点、世界观、自定义字段、标签、附件及 `[[名称]]` Wiki 双向引用。
- **写作规划**：三级大纲、时间线、伏笔、剧情线、人物关系图、灵感箱和章节完成 Checklist。
- **辅助分析**：写作统计、人物出场统计、一致性检查、断链与关联提示。
- **名字生成器**：12 类名字、8 种风格，支持命名条件、家族与主题系列、项目避重、锁定、收藏、历史和专属词库。
- **AI 辅助**：左侧任务与参考资料、右侧结果的双栏工作台，支持续写、润色、改写、摘要等任务和可复用 Prompt 模板。连接设置、模板编辑与请求预览按需打开。
- **导出与恢复**：Markdown、TXT、HTML、DOCX、EPUB、PDF 导出，回收站及整项目备份、校验和恢复。
- **工作区**：浅色／深色／跟随系统主题、专注模式、侧栏调整、快捷命令和未保存草稿保护。

## 开始使用

1. 创建项目时选择空目录，或打开已有 NovelForge 项目。
2. 在左侧建立卷、章或节，进入正文写作；人物、地点等资料可在对应页面维护。
3. 正文中使用 `[[人物名]]` 等引用关联资料；用写作规划、时间线和伏笔管理情节。
4. AI 辅助中选择任务及参考资料，查看请求预览后运行，再确认是否将结果应用到正文。
5. 使用导出生成阅读文件，使用整项目备份保留正文、资料、附件和历史。

常用快捷键：`Ctrl+S` 保存，`Ctrl+P` 快速打开，`Ctrl+Shift+P`（兼容 `Ctrl+K`）打开命令面板，`Ctrl+Shift+I` 记录灵感。

## AI 模式

### 本地离线

不需要 API Key，提供根据所选上下文组成的本地草稿。该模式不运行在线大模型。

### 兼容 Provider

在“连接设置”填写 OpenAI-compatible 服务的 Base URL、模型和可选 API Key。密钥只保留在当前窗口，不保存到项目或偏好。远程非加密 HTTP 地址会在发送前提示并要求确认。

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

结果可以流式查看和停止生成；未完成文本只供查看与复制，正文或选区变化会阻止直接应用旧结果。生成请求不自动重发。

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

桌面连接与布局专项可运行 `node scripts/codex-compatibility-ui-cdp.mjs` 和 `node scripts/ai-workbench-ui-cdp.mjs`，使用合成项目，不默认执行真实订阅生成。CI 包含前端、Rust 检查和 Windows CLI 兼容矩阵，实时结果见 [GitHub Actions](https://github.com/Gunanzhao/NovelForge/actions)。

插件扩展目前采用源码内显式注册的进程内 Registry，不从磁盘动态执行任意外部 JavaScript。
