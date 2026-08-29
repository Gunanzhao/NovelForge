# NovelForge

NovelForge 是一款本地优先的中文长篇小说 Markdown 创作工作台，采用 Tauri 2 + React + TypeScript + Vite + Rust + SQLite。

## 已实现

- 创建 / 打开小说项目，最近项目记录。
- 作品 / 卷 / 章 / 节导航，创建、重命名、排序和安全删除。
- CodeMirror 6 Markdown 编辑、编辑 / 预览 / 分栏模式。
- 防抖自动保存、恢复目录、原子临时文件、章节历史快照。
- 人物、地点、世界观、时间线、伏笔等资料卡 CRUD；资料保存为 SQLite 记录和可读 Markdown 镜像。
- Wiki 双向引用格式：[[人物名]]、[[地点名]]、[[世界观条目]]。
- SQLite FTS5 全文搜索和中文内容回退匹配。
- 写作统计、每日目标、专注模式、浅色 / 深色 / 跟随系统主题。
- 回收站、Markdown / TXT 导出、本地规则名字生成器。
- 时间线专用工作区：按故事日期排序事件，并关联章节、人物和地点。
- 伏笔专用清单：跟踪埋设、计划回收、实际回收和搁置状态，并可从章节引用跳转正文。
- 人物关系图：用关系线连接人物，支持关系类型、强度、备注和人物资料跳转。
- 命令面板：`Ctrl+K` 搜索工作台命令，并可在面板中注册和恢复快捷键。

## 开发

需要 Node.js、pnpm、Rust MSVC 工具链和 Windows WebView2。

~~~bash
pnpm install
pnpm tauri dev
~~~

验证命令：

~~~bash
pnpm typecheck
pnpm lint
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
~~~

如果 pnpm 首次安装提示依赖构建脚本，按组织策略只批准当前项目需要的 esbuild，不要批量批准未知脚本。

## 数据安全

正文不进入数据库专有格式，而是保存在项目 manuscript/ 下的普通 Markdown 文件。SQLite 数据库位于 .novelforge/database.sqlite，恢复文件位于 .novelforge/recovery/，历史位于 .novelforge/history/。删除内容先移动到 trash/，不会直接永久删除。

详细产品范围见 SPEC.md，任务状态见 TODO.md 和 PROGRESS.md。

## 当前范围

当前版本已覆盖 MVP 及 V0.2 写作规划基础能力。人物关系图、命令面板、AI Provider、DOCX/EPUB/PDF、附件库和高级一致性检查按后续版本继续开发；没有 API Key 时核心写作流程完全可用。
