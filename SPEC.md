# NovelForge 产品规格

NovelForge 是 Windows 11 x64 优先、本地优先的中文长篇小说 Markdown 创作工作台。正文始终以普通 `.md` 文件保存，SQLite 只负责元数据、索引、资料与统计；没有账号或云服务也必须可以创建、写作、搜索和导出小说。

## MVP 目标

- 创建、打开和记录最近小说项目。
- 作品 / 卷 / 章 / 节树状管理，删除进入回收站。
- CodeMirror 6 Markdown 编辑、预览和编辑/预览分栏。
- 防数据丢失：自动保存、恢复文件、原子临时文件、历史快照。
- 人物、地点、世界观 Wiki（含 `[[条目]]` 链接）资料管理。
- FTS5 + 内容回退的全文搜索、写作统计、专注模式。
- Markdown / TXT 项目导出。
- 无 API Key 时应用完整可用；AI 作为后续可选模块。

## 数据格式

每个项目目录包含 `project.json`、`manuscript/`、`characters/`、`locations/`、`world/`、`timeline/`、`outlines/`、`scenes/`、`foreshadowing/`、`notes/`、`research/`、`attachments/`、`trash/` 和 `.novelforge/`。核心实体使用 UUID、`created_at`、`updated_at`，项目 JSON 保留 `formatVersion`。

正文路径按卷归档：`manuscript/volume_001/chapter_001.md`；节使用同卷下的 `chapter_001/section_001.md`，仍是可直接打开的 Markdown 文件。

## 安全约束

保存先写恢复文件和同目录临时文件，完成正式文件替换及历史快照后才清理恢复文件。任何失败都保留原文件与恢复数据。数据库损坏不阻止直接读取 Markdown。日志不得含 API Key、完整正文或其他隐私内容。

## 后续版本

V0.2：章节大纲、场景卡、时间线、伏笔、看板、人物关系、命令面板、名字生成器。

V0.3：OpenAI-compatible Provider、续写、润色、改写、摘要与显式上下文选择。

V0.4：规则一致性检查、资料库、高级统计与更多导出格式。V1.0 目标为稳定的完整 Windows 小说工作流。

## V1.0 收尾状态（2026-08-31）

AI 上下文增强、命令与存储模块边界、持续集成、10 万字单章命令链验收和进程内插件 API 已实现并有自动化回归。插件 API 当前仅支持源码显式注册，外部插件加载属于后续版本能力。Windows release 构建、直连 CDP、官方 Tauri WebDriver、原生文件选择器、恢复重启流程、100,000 字滚动/输入观察和两种模式的 rAF/overflow 采样均已验证；E2E 可选测试封面夹具已用于复现六种导出，Markdown/TXT/HTML/DOCX/EPUB/PDF 已在对应阅读器完成本机视觉复核；不同硬件/阅读器组合的兼容性抽查属于后续可选工作。

## V1.0.0-rc.1 变更（2026-09-03）

- Rust commands 实现已按项目、正文、资料、恢复、回收站、一致性和导出领域拆分；storage 实现已按数据库、文件系统、迁移、Markdown 镜像、历史、搜索索引和日志拆分。Tauri command 名称、SQLite schema 与项目 Markdown 格式保持不变。
- Markdown 编辑器保留普通和命名脚注语法；预览显示引用与脚注区，HTML/EPUB 使用锚点，DOCX/PDF 以章节末尾列表保留脚注内容。
- Inspector 增加“字符转全角/半角”，默认只转换 ASCII 字母/数字并保护 Markdown 标记、代码块、行内代码和 URL；中文标点转换仍是独立功能，普通空格默认不转换。
- 全局右键菜单的 release CDP 回归扩展到正文树、CodeMirror、Wiki、场景卡、大纲、时间线、伏笔和看板；菜单支持边缘避让、子菜单、明暗主题、Escape 与外部点击关闭。

## V1.0.0-rc.2 最终修正（2026-09-03）

- 编辑器预览继续使用 ReactMarkdown/remark-gfm，并显式配置中文脚注标签、引用与返回正文锚点；脚注不在 inline code 或 fenced code 中解析。
- “字符转全角/半角”定义为完整 ASCII 可见字符范围 U+0021–U+007E 与对应 U+FF01–U+FF5E 的可逆转换；Markdown 标记、代码、URL、链接地址、Wiki/脚注语法、frontmatter 和表格结构受保护，普通空格默认不转换。
- Windows Native Dialog 验收通过地址栏导航、UIA ValuePattern、条件等待、控件重解析和最多三次有限重试完成；不依赖不稳定的文件列表索引。

## V1.1 自动资料识别

- 当前章节正文由纯本地 Mention Scanner 防抖扫描，不调用 AI，也不扫描整本小说的每个输入字符。
- 扫描识别人名、地点和世界观资料的标题及别名，并用本地规则提出新资料候选。
- fenced code、inline code、URL、Markdown 链接目标、图片路径和 Wiki Link 不参与识别；重叠命中优先已知资料和更长名称。
- 永久忽略项使用 `mention-ignore` 资料实体，镜像保存在 `mentions/`；数据库丢失时可由 Markdown 镜像恢复。
- Mention 索引属于可计算数据，可由正文与资料重新生成，不成为事实来源。
