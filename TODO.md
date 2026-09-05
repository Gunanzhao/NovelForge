# NovelForge 开发任务

> 当前版本：`1.1.0-rc.3`（预发布候选版）。Windows x64 安装包为 `NovelForge_1.1.0-rc.3_x64-setup.exe`；下载、发布状态及 SHA-256 校验文件见 [GitHub Release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.3)。
>
> rc.1/rc.2 的测试、benchmark、CI、tag 和发布记录属于各自历史版本，不作为 rc.3 通过证据。rc.3 最终数据统一见 [测试报告](TEST_REPORT.md#rc3-validation) 与 [发布清单](RELEASE_CHECKLIST.md#rc3-checklist)；全部本地门禁已通过，源码基线 CI 已通过。

## rc.3 当前待办

- [x] ISSUE-01：Inspector 不重复提示 Wiki；人物/地点/世界观已知 Wiki 计数、普通文本混合精确计数、未知 Wiki 与代码区排除均通过。
- [x] ISSUE-02：长 backtick/tilde fence、短 closer、混合字符、未闭合 fence、多 backtick inline code 和 Markdown helper 一致性回归通过。
- [x] 前端 frozen-lockfile 安装、typecheck、lint、34 文件 / 221 项测试及 pnpm audit 通过。
- [x] 前端 `pnpm build`（tsc + Vite）在 Tauri beforeBuild 中执行并通过，18.03 秒。
- [x] Rust check、fmt、Clippy `-D warnings` 及常规测试通过：74 passed / 2 ignored，6.78 秒；ignored 基准已另行通过。
- [x] Cargo audit 通过：exit 0，17 条 allowed warnings，与 rc.2 相同。
- [x] rc.3 两项 benchmark 通过（42.180 秒 / 22.605 秒，2 passed / 0 failed / 0 ignored）；数据完整性断言通过，无 panic/OOM/异常超时，采样及比较边界见 TEST_REPORT。
- [x] Windows `pnpm tauri build` 成功，EXE/NSIS 的 ProductVersion 均为 1.1.0-rc.3；大小及 SHA-256 见 TEST_REPORT。
- [x] CDP（WEBDRIVER=0，NATIVE=0）完整通过，含 Wiki 精确计数及原六项标记。
- [x] WebDriver（WEBDRIVER=1，NATIVE=0）完整通过，含 `WIKI_MENTION_COUNT_OK` 与原六项标记。
- [x] WebDriver + Native Dialog 完整通过（exit 0），包含原六项标记、`WIKI_MENTION_COUNT_OK` 和 `NATIVE_DIALOGS_OK`；日志 `src-tauri/target/rc3-e2e-native.log`。
- [x] CDP 已通过六个 V1.1 E2E 标记及 `WIKI_MENTION_COUNT_OK`；WebDriver 同样完整通过；Native Dialog 完整通过（exit 0）。
- [x] 源码基线 `0f1eb3f` 的 CI run `33966324453` 及 Frontend checks / Rust checks 均 completed / success。
- [x] ISSUE-05：main 分支保护已生效，必需检查为 Frontend checks / Rust checks，严格模式并约束管理员，不强制 PR，禁止强推及删除；完整配置见 RELEASE_CHECKLIST。rc.3 源码基线 CI 已通过。
- [x] 版本文件已升级 rc.3。
- [x] 版本文件与 Windows EXE/NSIS ProductVersion 均为 1.1.0-rc.3。
- [x] ISSUE-04：当前源码、本地验收与历史发布边界已同步；源码基线 CI 成功已记录。
- [x] rc.2 tag 未移动，远程与本地对象及解引用提交一致；详见 RELEASE_CHECKLIST。
- 发布边界：保留既有 rc.1/rc.2 tag 与发布资产，rc.3 以新的 tag/Release 发布。

## V1.1.0-rc.2 历史基线

依据既有 [rc.2 发布说明](docs/releases/v1.1.0-rc.2.md)：前端 33 文件 / 188 项、Rust 74 项常规测试通过；两项大型 benchmark 在 rc.2 发布轮次未重跑，后续基线补验已通过（详见 TEST_REPORT）。这些结果仅适用于对应历史版本。既有安装包为 `NovelForge_1.1.0-rc.2_x64-setup.exe`；不将后续源码修复归入该安装包。

> 下方已勾选条目为对应历史阶段记录，不代表 rc.3 门禁完成。

状态：`[ ]` 未开始，`[~]` 进行中，`[x]` 完成，`[!]` 阻塞。

## Phase 1：基础框架

- [x] 初始化 Tauri 2 + React + TypeScript + Vite
- [x] 接入 Tailwind CSS、Zustand、CodeMirror 6、Vitest
- [x] 建立 Rust 命令层、SQLite 数据库和统一错误处理
- [x] 完成三栏桌面工作台壳层、主题和布局折叠
- [x] 添加 ESLint、基础日志和开发文档
- [x] 在本机完成 `pnpm tauri dev` 交互验收

## MVP：项目与正文

- [x] 创建 / 打开项目及最近项目
- [x] 卷 / 章 / 节创建、重命名、拖拽排序、移动、递归复制、批量选择、删除、恢复
- [x] Markdown 编辑、预览、分栏和格式工具栏
- [x] 自动保存、恢复文件、原子写入和历史快照
- [x] 版本历史查看和恢复
- [x] 回收站查看、恢复和永久删除
- [x] 人物、地点、世界观条目 CRUD
- [x] `[[Wiki链接]]` 识别与条目快速打开
- [x] SQLite FTS5 全文搜索及类型 / 卷 / 标签 / 大小写 / 当前文档过滤
- [x] Ctrl+F 当前文档搜索、Ctrl+Shift+F 全项目搜索、Ctrl+P 快速打开
- [x] 总字数、今日新增、目标进度统计
- [x] Markdown / TXT 导出
- [x] F11 专注模式、浅色 / 深色 / 跟随系统主题
- [x] 中文写作检查工具（仅提示，不自动改正文）

## V0.2+

- [x] 章节大纲和场景卡
- [x] 时间线与伏笔管理（专用视图、章节关联与状态跟踪）
- [x] 写作看板
- [x] 人物关系图
- [x] 命令面板和可注册快捷键
- [x] 本地规则名字生成器
- [x] AI Provider、上下文预览、续写 / 润色 / 改写 / 扩写 / 缩写 / 摘要 / 大纲 / 对话 / 设定建议 / 名字生成
- [x] 规则一致性检查
- [x] HTML / DOCX / EPUB / PDF 导出，支持整本 / 指定卷 / 指定章节与元数据选项
- [x] 资料库附件导入
- [x] 详细写作趋势与章节统计
- [x] 大型最终验收（10 卷、1000 章、100 万字、100 人物、100 地点、200 世界观、500 时间线、100 伏笔；事务化真实命令链 51.19 秒）
- [x] 作品 / 卷 / 章节三级大纲、人物/地点扩展字段、自定义字段与地点树层级
- [x] 时间线标签、伏笔部分回收状态、Wiki 正文反向引用和 TXT 纯文本清理
- [x] 正文树窗口化渲染、保存失败回滚、损坏数据库 Markdown 重建和分级脱敏日志
- [x] 浏览器 fallback 与桌面项目格式对齐：层级路径、递归回收恢复和二进制导出边界

## V1.1

- [x] P1 自动资料识别：本地规则扫描、已知资料/别名命中、Markdown 安全排除、重叠消解、单次/永久忽略和显式 Wiki 插入
- [x] P2 剧情线 Story Arc：专用视图、章节多选关联、milestone 拖拽/排序、Inspector、回收站/恢复和一致性健康提示
- [x] P3 人物出场统计：首次/最近登场、章节与提及计数、共同人物、主要地点、章节跳转和窗口化人物矩阵
- [x] P4 AI Prompt Preset：项目模板 CRUD/复制/重命名、全部 V1.1 变量、解析错误阻断、执行预览和显式结果应用
- [x] P5 灵感 Inbox：快捷捕获、分类视图、搜索/标签/排序、回收站以及人物/地点/世界观/场景/伏笔/剧情节点/笔记转换
- [x] P6 章节完成 Checklist：项目模板、新章节继承、独立 workflowStatus、Inspector、Dashboard 汇总、树过滤和右键快捷动作

## V1.1.0-rc.1 Final Validation（2026-09-05）

- [x] 旧项目直接打开、正文普通 Markdown、P1 可重建扫描与四类新增实体镜像恢复。
- [x] `pnpm install --frozen-lockfile`、typecheck、lint、30 文件 / 154 项测试、build 和 `pnpm audit --audit-level high` 通过。
- [x] `cargo check --locked`、47 项常规测试和 `cargo-audit 0.22.2` 通过；RustSec 允许的平台/停止维护警告保持可见。
- [x] 1000 章 / 100 万字基准 36.48 秒；50 Story Arc、500 Inbox、100 Prompt Preset、1000 Checklist 基准 18.71 秒。
- [x] `pnpm tauri build` 生成 V1.1 release EXE 和 NSIS；CDP、WebDriver、Native Dialog 全部新旧标记通过。
- [x] 最新 `main` HEAD 的 GitHub Actions Frontend/Rust 检查成功。
- [x] [v1.1.0-rc.1 Pre-release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.1) 和 Windows NSIS 安装包已发布。

## 最终验收

> 本节记录上一候选的历史验收；2026-09-03 当前 RC 的状态以“V1.0.0-rc.1 当前收尾”为准。

- [x] Windows x64 release EXE 与 NSIS 安装包构建、启动冒烟
- [x] P2/P3 代码收尾：AI 上下文增强、命令与存储模块边界、GitHub Actions CI、10 万字单章验收、内部插件 API
- [x] 真实桌面验收收尾（直连 CDP、官方 Tauri WebDriver、原生文件选择器/确认框/提示框、恢复重启自动化、两种模式量化 FPS、100,000 字滚动/输入观察和带测试封面的六种导出阅读器视觉复核均已通过；Calibre 目录双击已验证正文跳转）

> 历史记录：以下 rc.1 收尾条目保留用于追溯；本轮 rc.2 最终状态以文末“V1.0.0-rc.2 Final Validation”为准。

## V1.0.0-rc.1 当前收尾（2026-09-03）

- [x] Rust commands 按领域真实拆分，`commands/mod.rs` 保留共享 helper 与兼容 re-export，未使用 `include!` 拼接。
- [x] Rust storage 按数据库、文件系统、迁移、镜像、历史、搜索索引和日志真实拆分。
- [x] Markdown 普通/命名脚注编辑、预览及 HTML/EPUB 锚点导出；DOCX/PDF 保留脚注内容。
- [x] Markdown 安全字符全角/半角转换，默认不转换普通空格，中文标点转换保持独立。
- [x] `pnpm.cmd install --frozen-lockfile`、typecheck、lint、72 项前端测试、build、cargo check/test 通过。
- [x] 1000 章/100 万字 ignored 基准通过（58.76 秒），10 万字单章常规 Rust 验收通过。
- [x] `pnpm.cmd tauri:build` 生成 1.0.0-rc.1 release EXE 与 NSIS。
- [x] 当前 HEAD 直连 release CDP E2E 通过 `CONTEXT_MENU_OK`、`PLANNING_CONTEXT_MENU_OK`、`EXPORTS_OK` 及全部既有阶段标记。
- [~] 官方 WebDriver + 原生附件选择器复跑：核心流程可运行，但本机出现焦点/列表刷新竞态，需稳定桌面焦点环境复跑后再关闭该证据项。
- [x] 发布候选代码 GitHub Actions Frontend/Rust 两个 job：提交 `40ae175` 的 run `33699593424` 均 success；发布记录提交 `1751dfd` 的 run `33705658724` 也均 success。
- [x] `v1.0.0-rc.1` 远程 tag：已创建并推送，指向已通过 CI 的发布候选代码提交 `40ae175`。

## V1.0.0-rc.2 Final Validation（2026-09-03）

- [x] FIX-01：ReactMarkdown/remark-gfm 真实渲染普通、命名、多次引用和中文脚注；引用与返回正文锚点匹配，代码区伪脚注不解析；组件级测试已加入。
- [x] FIX-02：完整 ASCII 可见字符 U+0021–U+007E 与 U+FF01–U+FF5E 可逆转换；Markdown 标记、代码、URL、链接地址、Wiki/脚注语法、frontmatter 和表格结构受保护，普通空格默认不转换。
- [x] FIX-03：Native Dialog 使用地址栏导航、ValuePattern、控件重解析、条件等待和最多三次有限重试；rc.2 release `NATIVE_DIALOGS_OK` 通过。
- [x] 前端 17 个测试文件 / 75 项测试、typecheck、lint、build 通过；Rust 35 项常规测试、cargo check 通过。
- [x] 1000 章 / 100 万字 ignored 基准通过（50.90 秒）；`pnpm.cmd tauri:build` 生成 rc.2 EXE 与 NSIS。
- [x] rc.2 release CDP 与官方 WebDriver（含 Native Dialog）全部阶段标记通过，包括 `CONTEXT_MENU_OK`、`PLANNING_CONTEXT_MENU_OK`、`NATIVE_DIALOGS_OK`、`EXPORTS_OK`。
- [x] rc.2 远程 tag、最新 HEAD GitHub Actions 和 GitHub Pre-release 已完成：`main`=`5aac219`，`v1.0.0-rc.2`=`961ad26`，run #11（`33712235453`）success；[Pre-release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.0.0-rc.2) 已附加 NSIS 安装包；已公开 rc.1 不移动。
- [ ] `main` Required Checks：保留为 GitHub Settings / Rulesets 管理员待办。

## rc.3 当前交付状态

rc.3 候选源码、本地产物及三种桌面回归均已验收。发布版本为 `v1.1.0-rc.3`，附件包括 `NovelForge_1.1.0-rc.3_x64-setup.exe` 与 `SHA256SUMS.txt`；安装包 SHA-256 为 `cf5b38c3aee63e53f0791a1329cc75d072c623d43eb4d1e27d4e10228c70a92f`。既有 rc.1/rc.2 标签和历史发布资产保留。

源码基线 `0f1eb3f8756a5936491f483c783387598b01a3d7`（`fix/v1.1-audit-rc3`）已推送；[CI run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) 为 `completed / success`，Frontend checks 与 Rust checks 均为 `completed / success`。全分支 push 触发已由该 run 验证。

该记录对应功能源码基线；验收文档提交 `f2e2d67` 的 [main CI 33967007863](https://github.com/Gunanzhao/NovelForge/actions/runs/33967007863) 也已通过。发布文档在工作分支通过必需检查后合入 main；最新状态见 [main 工作流](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)。

本地测试、两项基准、三种桌面 E2E、产物摘要及历史 tag 证据见 [TEST_REPORT](TEST_REPORT.md#rc3-validation) 与 [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md#rc3-checklist)。rc.2 tag 已核验未移动，main 保护规则已生效。
