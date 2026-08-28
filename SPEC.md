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
