# NovelForge

NovelForge 是一款本地优先的中文长篇小说 Markdown 创作工作台，采用 Tauri 2 + React + TypeScript + Vite + Rust + SQLite。

## 已实现

- 创建 / 打开小说项目，最近项目记录。
- 作品 / 卷 / 章 / 节导航，创建、重命名、拖拽排序、移动、复制、批量选择和安全删除。
- CodeMirror 6 Markdown 编辑、编辑 / 预览 / 分栏模式。
- 防抖自动保存、恢复目录、原子临时文件、章节历史快照。
- 人物、地点、世界观、时间线、伏笔等资料卡 CRUD；资料保存为 SQLite 记录和可读 Markdown 镜像。
- Wiki 双向引用格式：[[人物名]]、[[地点名]]、[[世界观条目]]。
- SQLite FTS5 全文搜索和中文内容回退匹配。
- 写作统计、每日目标、专注模式、浅色 / 深色 / 跟随系统主题。
- 回收站、Markdown / TXT / HTML / DOCX / EPUB / PDF 导出；支持整本、指定卷、指定章节和元数据配置；附带本地规则名字生成器。
- 时间线专用工作区：按故事日期排序事件，并关联章节、人物和地点。
- 伏笔专用清单：跟踪埋设、计划回收、实际回收和搁置状态，并可从章节引用跳转正文。
- 人物关系图：用关系线连接人物，支持关系类型、强度、备注和人物资料跳转。
- 命令面板：Ctrl+Shift+P（兼容 Ctrl+K）搜索工作台命令，并可在面板中注册和恢复快捷键；Ctrl+P 快速打开条目。
- 一致性检查：扫描断开的 Wiki、章节引用、重复资料、人物关系和伏笔状态。
- 资料附件：将参考文档、图片和素材复制到项目 `attachments/`，并支持说明编辑与回收站恢复。
- 详细统计：查看当前卷 / 章节、今日 / 昨日 / 本周 / 本月、连续写作、活跃天数和章节字数排行。
- AI 辅助：支持 OpenAI-compatible Provider、显式上下文预览、续写/润色/改写/扩写/缩写/摘要/大纲/对话/设定建议/名字生成，以及不依赖 API Key 的本地草稿模式。
- 资料库支持人物/地点扩展字段、自定义字段、标签排序、地点树层级和正文 Wiki 反向引用。
- 写作规划支持作品/卷/章节三级大纲、时间线标签、伏笔“部分回收”状态和正文树虚拟化。
- 数据安全支持失败保存回滚、损坏 SQLite 可逆隔离并从 Markdown 镜像重建、分级脱敏日志。

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

详细产品范围见 SPEC.md，任务状态见 TODO.md 和 PROGRESS.md；插件扩展协议见 docs/PLUGIN_API.md，审计收尾记录见 AUDIT_FIX_PLAN.md。

## 当前范围

当前版本已覆盖构建任务文档中的 MVP、写作规划、关系图、一致性、附件、结构管理、多格式导出、AI 辅助、数据恢复与大型正文树性能能力；1000 章 / 100 万字真实文件与 SQLite 性能验收已通过，Windows x64 release EXE 与 NSIS 安装包已构建并完成进程级冒烟。直连 CDP、官方 Tauri WebDriver、原生文件选择器、恢复重启和 100,000 字单章 rAF/overflow 采样均有回归脚本；E2E 还支持可选测试封面夹具并保留项目供外部阅读器加载复核，PDF 已完成 Edge/SumatraPDF 跨阅读器视觉核对。剩余发布门禁是滚动/输入主观体感，以及 Markdown/TXT/HTML/DOCX/EPUB 五种导出文件的逐页视觉结构核对。没有 API Key 时核心写作流程和本地 AI 草稿模式完全可用。
