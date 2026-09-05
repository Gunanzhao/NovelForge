# NovelForge

NovelForge 是一款本地优先的中文长篇小说 Markdown 创作工作台，采用 Tauri 2、React、TypeScript、Rust 和 SQLite。

当前版本：**1.1.0-rc.4（预发布）**。

- [下载 Windows x64 安装包](https://github.com/Gunanzhao/NovelForge/releases/download/v1.1.0-rc.4/NovelForge_1.1.0-rc.4_x64-setup.exe)
- [Release 与 SHA-256 校验文件](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.4)
- [测试报告](TEST_REPORT.md) · [rc.4 发布说明](docs/releases/v1.1.0-rc.4.md)

## rc.4：Codex 订阅接入（实验性）

AI 辅助新增 Codex 模式，使用本机官方 CLI 的 ChatGPT 登录和订阅额度，覆盖续写、润色、分析及提示词模板；支持模型选择、推理强度、流式输出和停止生成。现有 HTTP Provider 和离线模式继续保留。

在“AI 辅助”选择“Codex 订阅”，点击“检查连接 / 刷新登录”；未登录时可通过官方浏览器流程登录。首个验证 CLI 版本为 **0.149.1**，CLI 不随安装包分发。

NovelForge 为自己的子进程固定使用官方订阅服务，生成只含模型名称和推理参数的独立文本目录，并关闭工具、MCP 和插件，不修改全局 OpenCodex 配置。生成结果需确认后应用；正文或选区已变化时会阻止覆盖。

真实订阅验收使用 `gpt-5.6-luna` 和合成小说，其他模型的可用性由账号权限及 CLI 返回列表决定；这不是额外独立额度。使用步骤和边界见 [Codex 接入说明](docs/CODEX_INTEGRATION.md)。

rc.3 的 Wiki 统计及 Markdown 边界修复继续保留；[rc.3 历史发布说明](docs/releases/v1.1.0-rc.3.md)中的数字只代表该历史版本。

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
- 自动资料识别：在当前章节本地识别人名、地点、世界观标题和别名，提出受控候选，并支持创建资料、插入 Wiki 与永久忽略。
- 剧情线：集中管理状态、优先级、章节关联和有序剧情节点，并提供章节辅助栏关联与一致性健康提示。
- 人物出场统计：按需扫描全文，显示首次/最近登场、共同人物、主要地点和窗口化章节人物矩阵。
- AI Prompt 模板：在项目内保存可复用模板，使用白名单变量显式展开上下文，预览最终 Prompt 后再运行。
- 灵感箱：使用 `Ctrl+Shift+I` 快速记录，按状态、标签和时间整理，并转换为资料、场景、伏笔、笔记或剧情线节点。
- 章节完成 Checklist：项目模板由新章节继承，每章独立保存工作流和检查项，Dashboard 按卷汇总进度。

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
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm tauri build
~~~

如果 pnpm 首次安装提示依赖构建脚本，按组织策略只批准当前项目需要的 esbuild，不要批量批准未知脚本。

## 数据安全

正文不进入数据库专有格式，而是保存在项目 manuscript/ 下的普通 Markdown 文件。SQLite 数据库位于 .novelforge/database.sqlite，恢复文件位于 .novelforge/recovery/，历史位于 .novelforge/history/。删除内容先移动到 trash/，不会直接永久删除。

资料镜像在保存时写入版本化 `novelforgeEntity` JSON 前置元数据，完整保留多行字段、空白、标签和 JSON 类型，后面的 Markdown 是可读视图。恢复时校验两者一致；人工修改资料镜像后应同步这两个表示，发生冲突会报出文件路径并中止恢复。旧资料在下一次通过应用保存时升级镜像；旧镜像仍可读取，但旧格式已经丢失的字段边界无法可靠推断，恢复不会改写这些原文件。正文 Markdown 的编辑方式不受影响。

恢复前检查正文、资料、历史和恢复目录的路径边界。损坏数据库重建失败时尝试恢复原数据库及日志侧文件，错误会明确报告回滚结果；章节读取失败时终止导出，不产生缺失正文的成功结果。

Markdown 预览支持 HTTP/HTTPS 远程图片，这类图片会向其托管服务器请求资源。AI 最终预览分别展示 System Prompt 与 User Prompt，字符数和估算 Token 包含两者；前端合计安全阈值为 80,000 字符，后端硬上限为 200,000 字符。

## V1.1.0-rc.2 审阅修复

- 防止资料建档的异步响应覆盖最新正文；搜索和人物统计丢弃过期响应。
- 修复资料镜像无损恢复、章节状态镜像同步、恢复目录扫描与失败回滚。
- 跨卷/章节移动失败时同时恢复文件位置与原始镜像内容，并明确报告回滚失败。
- 导出明确报告缺失或不可读章节；中文搜索返回限定长度摘要。
- 小节的剧情线关联归入父章节，多卷推进顺序与章节树一致，检查结果可定位资料。
- AI 预览和限额覆盖完整请求；收件箱筛选后的详情仅对应可见条目。
- CI 增加 Rust 格式检查和零警告 Clippy 门禁。

发布说明与兼容性边界见 [v1.1.0-rc.2](docs/releases/v1.1.0-rc.2.md)。

本 README 汇总产品范围、构建方式、数据安全边界和当前发布状态。

## 当前范围

当前版本覆盖核心写作、资料管理、规划、多格式导出、数据恢复和 AI 辅助。rc.4 通过 233 项前端测试、83 项 Rust 常规测试及 Windows 安装后 CDP 桌面回归，并完成真实 Codex 订阅写作、取消和哨兵保护验收。rc.1/rc.2/rc.3 的其他测试与基准数字只用于历史追溯，详见 TEST_REPORT。

`1.1.0-rc.1` 的直连 release CDP、官方 Tauri WebDriver、原生文件选择器、恢复重启、六项新增工作流、右键菜单、AI Provider、回收站和导出验收均通过。GitHub Pre-release：[v1.1.0-rc.1](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.1)；Windows 安装包为 `NovelForge_1.1.0-rc.1_x64-setup.exe`。

## V1.1.0-rc.1 历史记录（2026-09-05）

- 自动资料识别不会逐字扫描整本小说；正文编辑时只防抖扫描当前章节，人物统计按需分批读取全文。
- 剧情线、Prompt 模板、灵感和 Checklist 复用项目实体并保存可读 Markdown 镜像，旧项目无需迁移。
- Prompt 模板只解析模板中明确引用的白名单上下文；运行前显示最终 Prompt、上下文项、字符数和估算 Token。
- 章节 Checklist 与原有正文节点状态相互独立；修改项目模板不会覆盖已有章节。
- 本地门禁通过：30 个前端测试文件 / 154 项测试、47 项 Rust 常规测试、`pnpm audit` 无已知漏洞、RustSec 无阻断性漏洞。
- 1000 章 / 100 万字基准为 36.48 秒；50 条剧情线、500 条灵感、100 个 Prompt 模板、1000 份 Checklist 的 V1.1 基准为 18.71 秒。
- release EXE：17,422,848 bytes，SHA-256 `94DCE86B4F3420C29F75F4FC5FB762BDAE98209B4E524134415519E1908563C2`。
- NSIS 安装包：5,154,783 bytes，SHA-256 `E0E80D72E50E6484FEE1A9C9C0608291C4B83DAA3AEB7751A84064B871C11DB5`。

## V1.0.0-rc.2 最终修正（2026-09-03）

- FIX-01：编辑器预览使用 ReactMarkdown + remark-gfm 真正渲染普通/命名脚注，提供中文脚注标签、引用锚点和返回正文锚点；组件级测试覆盖多次引用、中文内容和代码区排除。
- FIX-02：字符全角/半角转换覆盖 U+0021–U+007E 与 U+FF01–U+FF5E，保护 Markdown 标记、代码、URL、链接地址、Wiki/脚注语法、frontmatter 和表格结构；普通空格仍需显式选项。
- FIX-03：Native Dialog UI Automation 改为地址栏导航、ValuePattern 优先、控件重解析和最多三次有限重试；rc.2 release 已通过 `NATIVE_DIALOGS_OK` 及全部桌面阶段标记。
- rc.2 发布候选代码提交为 `961ad26`，旧 `v1.0.0-rc.1` tag 未移动；`main` 已推送至 `5aac219`，GitHub Actions run #11（`33712235453`）通过。
- GitHub Pre-release：[v1.0.0-rc.2](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.0.0-rc.2) 已发布并附带 NSIS 安装包 `NovelForge_1.0.0-rc.2_x64-setup.exe`（SHA-256：`C760969ECC72DEA0A7B6FFC5026C49B72597C68972FA41AAC9697412FA2ABD1A`）。

## rc.3 历史交付状态

rc.3 候选源码、本地产物及三种桌面回归均已验收。发布版本为 `v1.1.0-rc.3`，附件包括 `NovelForge_1.1.0-rc.3_x64-setup.exe` 与 `SHA256SUMS.txt`；安装包 SHA-256 为 `cf5b38c3aee63e53f0791a1329cc75d072c623d43eb4d1e27d4e10228c70a92f`。既有 rc.1/rc.2 标签和历史发布资产保留。

源码基线 `0f1eb3f8756a5936491f483c783387598b01a3d7`（`fix/v1.1-audit-rc3`）已推送；[CI run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) 为 `completed / success`，Frontend checks 与 Rust checks 均为 `completed / success`。全分支 push 触发已由该 run 验证。

该记录对应功能源码基线；验收文档提交 `f2e2d67` 的 [main CI 33967007863](https://github.com/Gunanzhao/NovelForge/actions/runs/33967007863) 也已通过。发布文档在工作分支通过必需检查后合入 main；最新状态见 [main 工作流](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)。

本地测试、两项基准、三种桌面 E2E、产物摘要及历史 tag 证据见 [TEST_REPORT](TEST_REPORT.md#rc3-validation) 与 [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md#rc3-checklist)。rc.2 tag 已核验未移动，main 保护规则已生效。

[![main CI](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)

徽章展示 main 分支的实时工作流状态，与上述源码基线的固定验收记录分别使用。
