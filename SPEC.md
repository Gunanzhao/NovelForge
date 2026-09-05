# NovelForge 产品规格

> 当前版本：`1.1.0-rc.3`（预发布候选版）。Windows x64 安装包为 `NovelForge_1.1.0-rc.3_x64-setup.exe`；下载、发布状态及 SHA-256 校验文件见 [GitHub Release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.3)。
>
> rc.1/rc.2 的测试、benchmark、CI、tag 和发布记录属于各自历史版本，不作为 rc.3 通过证据。rc.3 最终数据统一见 [测试报告](TEST_REPORT.md#rc3-validation) 与 [发布清单](RELEASE_CHECKLIST.md#rc3-checklist)；全部本地门禁已通过，源码基线 CI 已通过。

## rc.3 补充验收规格

- **ISSUE-01（Wiki 统计）**：区分识别建议与统计语义。Mention Inspector 不重复提示已有 Wiki；统计应计入已知人物、地点和世界观的 Wiki mention。普通文本与 Wiki 混合时精确累计，未知 Wiki 不生成已知资料计数，代码区 Wiki 仍排除。修复已完成，全部新增回归已纳入 rc.3 前端 34 文件 / 221 项测试并通过；三种桌面 E2E 均已完整通过。
- **ISSUE-02（Markdown 边界）**：统一 Markdown protected-range 处理；fence opener 长度至少 3，closer 字符相同且长度不小于 opener，多 backtick inline code 按相同 delimiter 长度闭合，未闭合 fence 保护到文末。保留 URL、链接/图片目标、Wiki 和 frontmatter 边界，核对与 Markdown 字符转换 helper 的一致性。修复已完成，全部新增回归已纳入 rc.3 前端 34 文件 / 221 项测试并通过；三种桌面 E2E 均已完整通过。

验收示例：已知人物“林月”的正文 `林月走进房间。[[林月]]拿起书。` 应统计为 2 次；Inspector 不应再次推荐已有 Wiki。上述 rc.3 验收要求已由新增自动化回归验证；不适用于既有 rc.2 安装包，三种桌面 E2E 均已完整通过。

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

保存先写恢复文件和同目录临时文件，完成正式文件替换及历史快照后才清理恢复文件。进入恢复文件写入之后的失败必须保留原文件与恢复数据；若在读取原正文或写入恢复文件之前失败，界面只报告保存失败，不得误报恢复数据已经保留。数据库损坏不阻止直接读取 Markdown。日志不得含 API Key、完整正文或其他隐私内容。

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
- 识别建议模式应排除 fenced code、inline code、URL、Markdown 链接目标、图片路径和已有 Wiki Link；重叠命中优先已知资料和更长名称。复杂 Markdown 边界与统计模式的 rc.3 补充验收见下节，新增自动化回归已通过，三种桌面 E2E 均已通过。
- 永久忽略项使用 `mention-ignore` 资料实体，镜像保存在 `mentions/`；数据库丢失时可由 Markdown 镜像恢复。
- Mention 索引属于可计算数据，可由正文与资料重新生成，不成为事实来源。

## V1.1 剧情线

- `story-arc` 复用统一资料实体，镜像保存到 `story-arcs/`，包含说明、状态、颜色、优先级、章节 ID 和有序 milestone。
- 状态支持计划中、进行中、暂停、已完成和已放弃；一个章节可以关联多条剧情线。
- 专用视图支持创建、编辑、删除、章节关联、节点完成、按钮排序、拖拽排序和章节跳转；章节 Inspector 可直接切换关联。
- 一致性检查报告失效章节、长期未推进、已完成但仍有开放节点以及 milestone 无效章节引用，所有结果只提示，不自动修改。

## V1.1 人物出场统计

- 人物资料页显示首次登场、最近登场、出现章节数、正文提及次数、共同出现人物和主要地点，章节项可跳转。
- 数据只来自 P1 Mention Scanner；同一章节正文和其小节合并为一个章节统计单位。
- 全文读取按 20 个文档分批进行，并以节点和资料更新时间建立内存缓存；用户可随时强制重新扫描。
- 章节人物矩阵按 40 章和 12 人物分页窗口化，1000 章 × 100 人物时不会同时渲染全部单元格。

## V1.1 AI Prompt 模板

- 项目模板使用 `prompt-preset` 资料实体并镜像到 `prompts/`，支持创建、编辑、重命名、复制、删除和运行。
- 支持 `selection`、`currentParagraph`、`currentChapter`、`recentChapters:1/3/5/10`、`character:名称`、`location:名称`、`world:名称` 和 `storyArc:名称`。
- 所有变量必须在运行前解析成功；未知变量或缺失对象会显示“无法解析上下文”并阻止请求。
- 运行先显示最终 Prompt、显式上下文项、字符数和估算 Token，确认后才调用本地草稿或 Provider。
- rewrite 模板结果只提供复制、取消、替换选区和插入选区后，不会自动修改正文。

## V1.1 灵感 Inbox

- `Ctrl+Shift+I` 在项目内打开快速记录，标题可选，正文必填，标签使用逗号分隔。
- `inbox` 项目实体镜像保存在 `inbox/`；Inbox 页面提供未整理/已整理、全文过滤、标签过滤、时间排序、删除和回收站恢复入口。
- 支持转换为人物、地点、世界观、场景卡、伏笔、普通笔记和指定剧情线 milestone。
- 转换成功后保留原灵感并写入 `processed`、`processedInto`；目标创建失败时不改变原条目，后续标记失败时回滚新目标或剧情线内容。

## V1.1 章节完成 Checklist

- 项目设置提供一个项目级 Checklist 模板；以后新建的章节复制当时模板，已有章节不随模板修改而覆盖。
- 每章独立保存 `workflowStatus` 和检查项完成状态，不改变已有 `Node.status`。
- 工作流支持草稿、初稿完成、自检完成、一校、二校和定稿；默认检查项为正文、错别字、人物一致性、时间线、伏笔、润色和最终复读。
- 章节 Inspector 显示完成数和百分比；Dashboard 按卷汇总检查项和定稿数；正文树可过滤未完成、未定稿和待人物一致性检查章节。
- 项目模板镜像位于 `checklist-templates/`，章节实例位于 `checklists/`，避免数据库恢复时混淆实体类型。

## rc.3 当前交付状态

rc.3 候选源码、本地产物及三种桌面回归均已验收。发布版本为 `v1.1.0-rc.3`，附件包括 `NovelForge_1.1.0-rc.3_x64-setup.exe` 与 `SHA256SUMS.txt`；安装包 SHA-256 为 `cf5b38c3aee63e53f0791a1329cc75d072c623d43eb4d1e27d4e10228c70a92f`。既有 rc.1/rc.2 标签和历史发布资产保留。

源码基线 `0f1eb3f8756a5936491f483c783387598b01a3d7`（`fix/v1.1-audit-rc3`）已推送；[CI run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) 为 `completed / success`，Frontend checks 与 Rust checks 均为 `completed / success`。全分支 push 触发已由该 run 验证。

该记录对应功能源码基线；验收文档提交 `f2e2d67` 的 [main CI 33967007863](https://github.com/Gunanzhao/NovelForge/actions/runs/33967007863) 也已通过。发布文档在工作分支通过必需检查后合入 main；最新状态见 [main 工作流](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)。

本地测试、两项基准、三种桌面 E2E、产物摘要及历史 tag 证据见 [TEST_REPORT](TEST_REPORT.md#rc3-validation) 与 [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md#rc3-checklist)。rc.2 tag 已核验未移动，main 保护规则已生效。
