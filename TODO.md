# NovelForge 开发任务

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
- [~] P2 剧情线 Story Arc
- [ ] P3 人物出场统计
- [ ] P4 AI Prompt Preset
- [ ] P5 灵感 Inbox
- [ ] P6 章节完成 Checklist

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
