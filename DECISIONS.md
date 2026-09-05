# 架构决策记录

> 当前版本：`1.1.0-rc.3`（预发布候选版）。Windows x64 安装包为 `NovelForge_1.1.0-rc.3_x64-setup.exe`；下载、发布状态及 SHA-256 校验文件见 [GitHub Release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.3)。
>
> rc.1/rc.2 的测试、benchmark、CI、tag 和发布记录属于各自历史版本，不作为 rc.3 通过证据。rc.3 最终数据统一见 [测试报告](TEST_REPORT.md#rc3-validation) 与 [发布清单](RELEASE_CHECKLIST.md#rc3-checklist)；全部本地门禁已通过，源码基线 CI 已通过。

## ADR-020：rc.3 Mention 建议与统计语义分离

- 状态：修复设计与验收约束已记录；修复实现及全部新增自动化回归已通过；三种桌面 E2E 均已通过。
- **ISSUE-01（Wiki 统计）**：区分识别建议与统计语义。Mention Inspector 不重复提示已有 Wiki；统计应计入已知人物、地点和世界观的 Wiki mention。普通文本与 Wiki 混合时精确累计，未知 Wiki 不生成已知资料计数，代码区 Wiki 仍排除。修复已完成，全部新增回归已纳入 rc.3 前端 34 文件 / 221 项测试并通过；三种桌面 E2E 均已完整通过。
- **ISSUE-02（Markdown 边界）**：统一 Markdown protected-range 处理；fence opener 长度至少 3，closer 字符相同且长度不小于 opener，多 backtick inline code 按相同 delimiter 长度闭合，未闭合 fence 保护到文末。保留 URL、链接/图片目标、Wiki 和 frontmatter 边界，核对与 Markdown 字符转换 helper 的一致性。修复已完成，全部新增回归已纳入 rc.3 前端 34 文件 / 221 项测试并通过；三种桌面 E2E 均已完整通过。
- 补充 ADR-013/015：继续使用本地可重建索引，不改变正文或资料事实来源；具体 API/helper 名称以最终源码为准，不将审计建议中的示例接口写成已实现接口。

## ADR-021：候选证据与已发布安装包分别记录

- rc.3 为当前预发布候选版本，使用新标签发布；版本文件统一为 rc.3。
- rc.1/rc.2 历史 tag 与发布记录保留，rc.3 修复、测试和构建结果不得追写为 rc.2 资产能力。
- 当前候选的测试数量、两项 benchmark、CI、分支保护和产物摘要均需对应源码/产物的实际验证证据。

## ADR-001：使用 Tauri 2

- 问题：需要桌面窗口、本地文件和 SQLite，同时保留 Linux/macOS 兼容空间。
- 可选方案：Electron、Tauri 2、纯浏览器。
- 最终选择：Tauri 2 + React/Vite 前端 + Rust 命令层。
- 原因：符合任务书推荐技术栈，前端复用性好，核心文件 IO 和数据库在 Rust 层集中处理。
- 影响：需要 Rust 工具链和 WebView2；浏览器开发模式提供 fallback，但生产数据路径由 Tauri 命令负责。
- 日期：2026-08-26

## ADR-002：正文使用 Markdown 文件，SQLite 只存索引和元数据

- 问题：数据库损坏或卸载不能导致正文不可读。
- 最终选择：每个卷 / 章 / 节都有普通 `.md` 文件；SQLite 存树节点、资料、搜索索引和统计。
- 原因：遵守 Markdown 优先与数据安全要求，用户可以脱离 NovelForge 读取正文。
- 影响：保存需要原子临时文件、恢复文件和历史快照；搜索需要增量索引。
- 日期：2026-08-26

## ADR-003：资料实体使用统一记录表

- 问题：人物、地点、世界观等字段各异，但都需要 UUID、搜索、标签和 CRUD。
- 最终选择：SQLite `entities` 表以 `kind + content_json` 保存扩展字段，文件镜像写入对应资料目录。
- 原因：首版可以保持模块边界和迁移简单，新增字段不破坏旧项目。
- 影响：复杂关系图和字段级索引留到后续版本；业务类型仍由 TypeScript 统一建模。
- 日期：2026-08-26

## ADR-004：V0.2 规划功能复用资料实体并由前端组织专用视图

- 问题：大纲和场景卡需要关联章节、排序和专用编辑体验，同时不能破坏已有项目格式。
- 最终选择：继续使用 `entities` 表和 Markdown 镜像；在 `content_json` 中保存 `chapterId`、`order` 与规划字段；前端提供大纲、场景卡和看板专用视图。
- 原因：不需要数据库迁移，旧项目仍可打开；正文仍是独立 Markdown 文件，资料也保留可读镜像。
- 影响：场景排序通过保存显式 `order` 实现；人物关系、时间线和伏笔的专用交互继续留在后续阶段。
- 日期：2026-08-29

## ADR-005：命令与存储采用兼容入口的渐进式模块化

- 问题：单体 commands.rs 和 storage_impl.rs 已包含稳定的 Tauri 命令与数据格式，直接一次性重写会增加回归风险。
- 最终选择：先迁移为 commands/mod.rs 与 storage/mod.rs，将 AI、搜索、统计实现真实迁移到独立文件，同时建立其余领域和 storage 子模块的稳定 facade；后续以一个领域一个提交继续移动实现。
- 原因：Tauri 命令宏需要稳定的注册路径；兼容入口可让前端和既有 Rust 集成测试在每一步保持可编译、可回归。
- 影响：当前未迁移实现仍位于兼容入口，facade 不执行动态代码；后续迁移只允许在 cargo check/test 通过后合并。
- 日期：2026-08-31

## ADR-008：RC 版本中的 Markdown 脚注采用无损降级

- 问题：正文需要支持普通/命名脚注，但 DOCX/PDF 当前导出链路尚未引入原生脚注关系。
- 最终选择：编辑模式保留原始 Markdown；预览和 HTML/EPUB 输出脚注引用锚点；DOCX/PDF 在章节末尾输出脚注列表，保证内容不丢失且不改变项目文件格式。
- 影响：脚注 ID、中文内容、多引用和异常引用由纯函数及 Rust 导出测试覆盖；后续如引入原生脚注可沿用同一解析模型。
- 日期：2026-09-03

## ADR-009：全角/半角转换只改安全字符，不改 Markdown 结构

- 问题：批量转换若触碰 Markdown 标记、代码或 URL，会产生不可见的格式和链接破坏。
- 最终选择：转换完整 ASCII 可见字符 U+0021–U+007E 与其全角对应范围 U+FF01–U+FF5E；Markdown 标记、代码块、行内代码、URL、链接地址、Wiki/脚注语法、frontmatter 和表格结构使用范围保护；普通空格只有显式 `convertSpace` 才转为 U+3000，中文标点转换保持独立命令。
- 影响：转换可重复、可逆，且不会改变 Markdown 结构；Inspector 提供独立“字符转全角/半角”操作。旧 rc.1 的英数字描述已由 rc.2 完整 ASCII 规格取代。
- 日期：2026-09-03

## ADR-010：RC 远程证据不得由历史 run 代替

- 问题：候选未推送时，历史 GitHub Actions run 或旧 release E2E 不能证明当前 HEAD。
- 最终选择：本地门禁、当前 release CDP 结果和已推送发布候选代码 `40ae175` 的 run `33699593424` 均按实际证据记录；发布记录提交 `1751dfd` 的 run `33705658724` 也已核验成功。收到发布确认后创建并推送 `v1.0.0-rc.1`，官方 WebDriver 原生附件选择器的系统竞态单独记录。
- 影响：发布清单明确区分本地、桌面和远程证据，避免把旧 commit 的成功状态冒充 RC 当前状态。
- 日期：2026-09-03

## ADR-011：生产代码变更后升级 RC 标签

- 问题：`v1.0.0-rc.1` 已公开，FIX-01/FIX-02 修改了生产代码，不能移动或覆盖已公开 tag。
- 最终选择：保留 `v1.0.0-rc.1` 指向 `40ae175`，rc.2 版本统一为 `1.0.0-rc.2`，新 tag 指向 rc.2 发布候选代码提交。
- 影响：旧版本可复现，rc.2 的 EXE/NSIS、CI 和 GitHub Pre-release 独立验证。
- 日期：2026-09-03

## ADR-012：Native Dialog 自动化采用有限条件重试

- 问题：Windows Explorer 原生选择器在 WebView2 焦点切换和列表刷新期间会替换 UIA 控件树。
- 最终选择：优先地址栏/ValuePattern，轮询重新定位控件，最多三次重试；只有真实完成路径选择、确认和附件入库才输出 `NATIVE_DIALOGS_OK`。
- 影响：不会用固定列表索引或无限循环掩盖失败；本机 rc.2 已通过完整 Native Dialog 流程。
- 日期：2026-09-03

## ADR-006：桌面 E2E 与 UI 帧率保留人工门禁

- 问题：Rust/浏览器单元测试可以覆盖数据命令，但不能证明 Windows WebView2 窗口中的鼠标链路、CodeMirror 帧率和外部阅读器渲染。
- 最终选择：自动门禁覆盖 release 构建、独立进程启动、真实命令链、官方 Tauri WebDriver/UI Automation 桌面流程和导出结构；CodeMirror FPS/滚动体感及六种导出文件打开后的视觉确认仍按桌面清单人工记录。
- 原因：早期环境没有 tauri-driver 或 msedgedriver；现已使用与 WebView2 151 匹配的官方驱动完成可重复窗口流程，并已准备外部便携阅读器做加载冒烟，但自动化驱动和文本/转换证据仍不能替代用户实际桌面渲染与逐页阅读器体验。
- 影响：P3-02 仍保留人工收尾门禁；量化 rAF/overflow 采样可以作为 FPS 补充证据，但不能把它、进程 Responding、命令层耗时或结构化导出断言标记为滚动体感/阅读器视觉验收。
- 日期：2026-08-31
- 补充：使用可选的测试封面夹具和保留项目目录提高外部阅读器复核的可重复性；加载、UI Automation 文本和归档结构仍不等同于逐页视觉验收。
- 收尾记录：2026-08-31 已在本机 release WebView2 完成滚动/输入观察，并在记事本、Edge、LibreOffice Writer、Calibre、SumatraPDF 和 Poppler 中完成六种导出物视觉复核；Calibre“第二卷”目录双击已验证正文跳转。后续不同硬件/阅读器组合复核属于可选兼容性抽查。

## ADR-007：PDF 中文字体嵌入与无字体回退

- 问题：旧版 PDF 使用 STSong-Light 外部字体声明，Edge 和 SumatraPDF 在本机实际打开时出现中文乱码。
- 最终选择：使用 printpdf 将可用的 Windows CJK TrueType/OpenType 字体子集嵌入 PDF；支持 NOVELFORGE_PDF_FONT 覆盖路径，无可用字体时回退旧版生成器以保持跨平台测试可用。
- 验证：commit e9ed8f3 的 release PDF 在 Edge、SumatraPDF 3.6.1 和 Poppler 中均显示正确中文与封面。
- 日期：2026-08-31

## ADR-013：V1.1 Mention 采用可重建的本地扫描

- 问题：长篇正文需要自动发现已有资料和潜在新资料，同时不能把每次输入变成全书扫描或隐式 AI 请求。
- 最终选择：前端纯函数屏蔽 Markdown 非正文范围后扫描当前章节；已知资料按标题和别名匹配，候选使用受控规则，命中按已知资料与长名称优先消除重叠。
- 数据：扫描结果不作为唯一事实来源；项目永久忽略项复用统一资料实体和 Markdown 镜像，保存在 `mentions/`。
- 影响：当前文档可防抖增量计算，人物统计可在 P3 按需读取章节并重建全文索引，旧项目无需迁移。
- 日期：2026-09-05

## ADR-014：剧情线复用 EntityRecord 与 Markdown 镜像

- 问题：剧情线需要状态、多个章节关联和有序 milestone，同时要求旧项目无感打开并可从数据库损坏中恢复。
- 最终选择：新增 `story-arc` 资料类型，将结构字段保存在 `content_json`，可读镜像保存在 `story-arcs/`；不增加 SQLite 表或提高 `formatVersion`。
- 影响：专用前端视图负责交互，通用回收站、搜索索引和镜像恢复继续生效；一致性检查在前端 fallback 与 Rust 命令中使用相同 issue code。
- 日期：2026-09-05

## ADR-015：人物统计只使用 Mention Scanner 可重建结果

- 问题：人物资料页和章节矩阵需要全文统计，但维护第二套识别规则会产生不一致，永久缓存也会成为新的数据丢失风险。
- 最终选择：P3 直接聚合 P1 Mention Scanner；章节和小节按所属章节合并，缓存仅保留在内存并由节点/资料更新时间失效。
- 性能：文档按 20 个一批读取，矩阵固定窗口为 40 章 × 12 人物，支持主动全文重扫。
- 影响：统计可由普通 Markdown 正文和资料镜像重建，不需要数据库迁移或新事实表。
- 日期：2026-09-05

## ADR-016：Prompt Preset 使用项目实体和显式变量展开

- 问题：硬编码 AI 动作难以覆盖用户工作流，模板又不能隐式发送整本书或所有资料。
- 最终选择：模板以 `prompt-preset` 实体和 `prompts/` Markdown 镜像保存；运行时只解析模板中出现的白名单变量，并先展示最终请求预览。
- 安全：任何变量解析失败都阻止请求；Prompt 超过现有 80,000 字符安全阈值时阻止发送；API Key 仍只保存在当前窗口。
- 影响：不改变 `AiCompletionInput` 或 Provider 配置格式，旧 AI 动作继续可用。
- 日期：2026-09-05

## ADR-017：Inbox 转换采用保留原文的补偿回滚

- 问题：Inbox 与目标实体都需要 Markdown 镜像，跨两个通用资料保存操作时不能因第二步失败丢失原始灵感。
- 最终选择：灵感保存为 `inbox` 实体；转换先创建或更新目标，再标记原条目。目标失败时原条目不变；标记失败时将新目标移入回收站，或把剧情线恢复为转换前内容。
- 影响：成功转换也不删除原条目，只记录 `processedInto`；旧项目无需迁移，数据库损坏可从 `inbox/` 镜像恢复。
- 日期：2026-09-05

## ADR-018：章节工作流独立于 Node.status

- 问题：V1.1 需要完整章节生产流程和自定义 Checklist，但扩展现有 Node 状态会改变旧项目语义。
- 最终选择：项目模板和章节 Checklist 复用统一资料实体；`workflowStatus` 保存在章节 Checklist 内容中，`Node.status` 原样保留。
- 继承：新章节创建后复制当时的项目模板；旧章节只在用户主动初始化时创建 Checklist，模板更新不覆盖已有状态。
- 恢复：项目模板和章节实例使用 `checklist-templates/`、`checklists/` 两个目录，防止同目录恢复时 kind 混淆。
- 日期：2026-09-05

## ADR-019：失败保存验收在恢复文件之后注入故障

- 问题：锁住正文文件可能让保存流程在读取旧正文时提前失败，此时恢复文件尚未创建，前端不能统一声称恢复数据已保留。
- 最终选择：编辑器仅在后端错误明确包含“恢复文件已保留”时显示对应状态；桌面 E2E 临时把当前章节历史目录替换为文件，使恢复文件与正文写入完成后在历史快照阶段失败。
- 影响：验收可以直接核对恢复文件、重启提示、预览和恢复；夹具在测试后恢复原历史目录，不依赖不同磁盘的文件共享语义。
- 日期：2026-09-05

## rc.3 当前交付状态

rc.3 候选源码、本地产物及三种桌面回归均已验收。发布版本为 `v1.1.0-rc.3`，附件包括 `NovelForge_1.1.0-rc.3_x64-setup.exe` 与 `SHA256SUMS.txt`；安装包 SHA-256 为 `cf5b38c3aee63e53f0791a1329cc75d072c623d43eb4d1e27d4e10228c70a92f`。既有 rc.1/rc.2 标签和历史发布资产保留。

源码基线 `0f1eb3f8756a5936491f483c783387598b01a3d7`（`fix/v1.1-audit-rc3`）已推送；[CI run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) 为 `completed / success`，Frontend checks 与 Rust checks 均为 `completed / success`。全分支 push 触发已由该 run 验证。

该记录对应功能源码基线；验收文档提交 `f2e2d67` 的 [main CI 33967007863](https://github.com/Gunanzhao/NovelForge/actions/runs/33967007863) 也已通过。发布文档在工作分支通过必需检查后合入 main；最新状态见 [main 工作流](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)。

本地测试、两项基准、三种桌面 E2E、产物摘要及历史 tag 证据见 [TEST_REPORT](TEST_REPORT.md#rc3-validation) 与 [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md#rc3-checklist)。rc.2 tag 已核验未移动，main 保护规则已生效。
