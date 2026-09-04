# 更新日志

## 1.1.0-rc.1（开发中）

### Added

- P1 自动资料识别：本地扫描当前章节中的人物、地点和世界观资料，支持标题/别名命中、规则候选、单次/永久忽略、创建资料和显式插入 Wiki。
- Mention Scanner 排除 fenced code、inline code、URL、Markdown 链接目标、图片路径和已有 Wiki Link，并对重叠名称优先保留已知资料和更长名称。
- 可重建的章节/实体出现索引，为人物出场统计提供统一数据来源。

### Data safety

- 永久忽略项保存为带 Markdown 镜像的项目实体；正文格式和已有项目 `formatVersion` 保持不变。

## 1.0.0-rc.2

### Added

- 编辑器预览真实渲染普通/命名 Markdown 脚注，提供中文无障碍标签、引用锚点和返回正文锚点；新增 React 组件级脚注回归测试。
- 字符全角/半角转换扩展为完整 ASCII 可见字符范围，并保护 Markdown 结构、代码、URL、链接地址、Wiki/脚注语法、frontmatter 和表格结构。

### Fixed

- 稳定 Windows Native Dialog UI Automation：地址栏导航、ValuePattern 优先、控件树重解析、条件等待和最多三次有限重试；不依赖文件列表索引。
- Inspector 宽度转换确认文案与完整 ASCII 产品规格一致。

### Release

- 版本升级为 `1.0.0-rc.2`；已公开的 `v1.0.0-rc.1` 不移动。GitHub [Pre-release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.0.0-rc.2) 已发布并附加 Windows NSIS 安装包 `NovelForge_1.0.0-rc.2_x64-setup.exe`。

## 1.0.0-rc.1

### Added

- 支持普通和命名 Markdown 脚注，预览显示脚注区，HTML/EPUB 输出提供锚点，DOCX/PDF 以章末列表保留内容。
- 增加 Markdown 安全的英文字母/数字全角与半角转换，代码块、行内代码、URL 和 Markdown 标记保持不变。
- 扩展 release WebView2 右键菜单验收，覆盖正文树、编辑器、规划条目、边缘避让、明暗主题和“运行一致性检查”插件扩展项。

### Changed

- Rust commands 按项目、正文、资料、恢复、回收站、一致性和导出领域拆分；storage 按数据库、文件系统、迁移、镜像、历史、搜索索引和日志拆分。
- 保持既有 Tauri command 名称、SQLite schema、Markdown 项目格式和浏览器 fallback 兼容。

### Fixed

- 统一 RC 文档中的已完成/待验收状态，早期测试结果保留为历史记录并明确标注。

## 0.1.0 - 2026-08-26

- 初始化 Tauri 2 + React 写作工作台。
- 增加本地优先项目格式、卷章节树、Markdown 编辑器和预览。
- 增加自动保存、恢复、历史、回收站、全文搜索、统计和 Markdown/TXT 导出。
- 增加人物、地点、世界观资料 CRUD、Wiki 链接和专注模式。

## 0.2.0 - 2026-08-29

- 增加“写作规划”入口，集中管理章节大纲、场景卡和写作状态。
- 增加按章节关联的大纲编辑器，内容继续写入项目资料 Markdown 镜像。
- 增加场景卡编辑、拖拽排序和上下移动，排序持久化到资料实体。
- 增加章节写作看板，支持拖拽或下拉切换章节状态。
- 增加规划数据工具与浏览器 fallback 集成测试。
- 增加人物关系图、命令面板和可注册快捷键。
- 增加 Wiki / 章节引用 / 关系资料一致性检查、近 30 日写作统计和章节字数排行。
- 增加桌面附件导入：项目内复制、元数据说明、搜索索引和回收站支持。
- 扩展项目导出：支持 DOCX、EPUB 和 PDF，并提供格式选择对话框。
- 增加可选 OpenAI-compatible Provider、显式上下文预览和续写/润色/改写/摘要任务；API Key 仅在当前请求内存中使用。

## 0.2.1 - 2026-08-30

- 完成正文树跨卷移动、递归复制、拖拽排序和批量选择/回收站操作，并同步更新 Markdown 文件路径。
- 增加 Ctrl+P 快速打开、Ctrl+F 当前文档搜索、Ctrl+Shift+F 全项目搜索和完整类型筛选。
- 导出新增 HTML、整本/指定卷/指定章节范围、标题/作者/目录/标题开关和封面路径配置。
- 扩展 AI 任务至扩写、缩写、章节摘要、大纲、角色对话、设定建议和名字生成；增加 Provider 名称、Temperature、Max Tokens 配置。
- 补齐附件打开与章节关联、历史 Diff/复制旧版本、回收站清空、详细统计和布局偏好持久化。

## 0.2.2 - 2026-08-30

- 补齐作品 / 卷 / 章节三级大纲、人物与地点扩展字段、自定义字段、地点层级和 Wiki 正文反向引用。
- 增加看板“初稿”、伏笔“部分回收”、时间线标签和真正的地点树前序排序。
- 增加正文树窗口化渲染，降低大型项目的 React DOM 开销。
- 强化保存事务：数据库或索引失败时恢复原正文并保留恢复文件；损坏 SQLite 可逆隔离并从 Markdown 镜像重建正文和资料索引。
- 增加 DEBUG/INFO/WARN/ERROR 项目日志、脱敏读取和设置页日志查看；TXT 导出移除 Markdown 标记。
- 最终自动化验证：前端 40/40、Rust 20 passed、1000 章 / 100 万字基准 30.83 秒、release EXE/NSIS 构建和独立启动冒烟通过。

## 未发布 - 2026-08-30

- 修复 GitHub Actions Ubuntu Rust CI：安装 Tauri 2 WebKitGTK/GTK 前置依赖，升级 Node 24 action runtime，并以 run 33529012970 的 Frontend/Rust 全绿结果关闭 P2-03。
- 审计 P1-01：为正文节点、卷元数据和资料镜像增加稳定 frontmatter；SQLite 损坏后可恢复 UUID、关系、地点树、章节关联和历史快照索引，并对旧项目缺少元数据写入 WARN。
- 审计 P1-02：统一节点路径分配，阻止回收站原路径复用；章节 sidecar 随正文安全删除、恢复和永久删除，并补充冲突恢复回归。
- 审计 P1-03：工具栏和快捷键改为 CodeMirror 选区 transaction，补齐基础 Markdown 格式命令并支持可重绑定 Ctrl+B/Ctrl+I。
- 审计 P1-04：Wiki 链接在预览和编辑模式中可导航；同名资料展示候选，缺失资料可跳转搜索，代码围栏不会触发 Wiki 误报。
- 审计 P1-05：一致性检查新增结构化人物年龄/生日/性别、死亡后时间线出现、相似名称、地点名称和时间线顺序/范围规则；新增问题均可定位且不扫描普通正文推断剧情错误。
- 审计 P1-06：导出改为统一 Markdown AST，TXT/HTML/DOCX/EPUB/PDF 保留语义结构；TXT 纯文本清理、EPUB 分章导航、DOCX 编号/封面资源和 HTML data URI 封面均已覆盖回归。
- P1 全量门禁：前端 58 项测试、Rust 32 项常规测试、1000 章/100 万字基准、Tauri release/NSIS 构建和独立 EXE 冒烟全部通过；仅保留真实 WebView2 桌面鼠标级 E2E 人工验收。
- P2-01：AI 上下文支持当前选区/段落、最近 1/3/5/10 章、指定正文与资料，显示字符/Token 预算；选区任务仅可替换选区或插入选区后。
- P2-02：commands.rs 迁移为 commands/mod.rs，AI/搜索/统计实现进入独立模块，并建立项目、正文、资料、恢复、回收站、一致性、导出及 storage 子模块边界；保持现有命令调用兼容。
- P2-03：新增 GitHub Actions CI，锁定 pnpm/Node 与 Rust stable，自动执行前端安装、类型检查、Lint、测试、构建及 Rust check/test。
- P2-04：新增超过 10 万中文字符单章的打开、编辑、插入、删除、搜索、保存和重开验收测试；桌面 E2E 增加可选真实 overflow/rAF FPS 采样，同时保留滚动输入体感人工记录。
- P3-01：新增 PluginRegistry 和 docs/PLUGIN_API.md，定义六类扩展点并注册内置名字生成器、一致性检查；V1.0 不执行任意外部 JavaScript。
- P3-02 预检：重新生成 Windows release EXE/NSIS 并完成独立启动响应检查；真实 WebView2 鼠标级 E2E 继续保留为人工验收。
- P3-02 自动化：新增 pnpm test:e2e:desktop 的 WebView2 CDP release 验收脚本，覆盖编辑器、历史、正文树、拖拽/批量恢复、资料、Wiki、设置/命令面板、规划、搜索、AI 双模式、真实重启恢复和六种导出生成/结构断言；官方 tauri-driver + WebDriver 与原生 UI Automation 文件选择器已通过。
- P3-02 验收边界：CodeMirror FPS/滚动体感和在实际 Word/WPS、LibreOffice/Calibre、Sumatra/Acrobat 等阅读器中打开六种导出文件仍需人工记录；不以结构断言替代视觉确认。
- P3-02 性能补充：直连 WebView2 2 秒 286 帧（约 142.8 FPS），官方 WebDriver + 原生对话框 2 秒 278 帧（约 139.0 FPS）；量化结果不替代滚动/输入体感和阅读器视觉确认。
- P3-02 阅读器复核补充：E2E 支持可选测试封面夹具和保留项目目录；六种导出已由记事本、Edge、LibreOffice Portable、Calibre Portable、SumatraPDF 完成加载/结构复核，逐页视觉仍保留人工门禁。
- P3-02 PDF 视觉修复：引入 printpdf 并嵌入 Windows CJK 字体子集，修复 Edge/SumatraPDF 中 STSong-Light 未嵌入导致的中文乱码；最新带封面 PDF 已在 Edge、SumatraPDF 和 Poppler 中确认中文、章节和封面可读。
- P3-02 修复后复核：官方 WebDriver + 原生对话框和 100,000 字 FPS 重跑通过（276 帧，约 137.7 FPS）；Markdown/TXT、HTML、DOCX 窗口视觉可读，EPUB 目录可读但正文链接跳转仍待复核。
- 清理 Rust 非阻塞 dead-code 警告，保留回收站数据库字段的明确模型语义。
- 为 React、CodeMirror、Markdown 和图标依赖增加生产分包；最大输出 chunk 降至约 364 kB，构建不再出现体积警告。
- 修复浏览器 fallback 的卷/章/节路径、递归回收站快照恢复和二进制导出提示，并补充回归测试。
- 扩展大型最终验收基准，覆盖 10 卷及完整资料规模，验证重新打开、统计和全文搜索。
- 正文读取失败改为返回明确错误；保存提交后的项目元数据和恢复文件清理改为安全的 best-effort，不再误报已提交内容为失败。
- 创建节点、重命名节点和资料镜像保存改为文件/SQLite/索引事务；失败时自动回滚，并保持章节 Markdown 标题同步。
- 浏览器 fallback 增加空标题、重复项目、无效状态和不存在目标的输入校验，前端回归测试增至 42 项。
- 事务化写入后大型最终验收耗时更新为 51.19 秒，最新 release 产物已重新构建。
- AI 结果取消操作补充 Escape 快捷键，取消时清理选区请求状态，避免误应用过期结果。

## 未发布 - 2026-08-31 收尾

- 完成 P3-02 桌面 E2E 人工门禁：release WebView2 大文档滚动/输入观察、FPS 量化、恢复重启和官方 WebDriver 流程均有记录。
- 使用记事本、Edge、LibreOffice Writer、Calibre 9.14.0、SumatraPDF 和 Poppler 完成本机六种导出格式视觉复核；Calibre 目录双击“第二卷”已验证正文跳转。
- AUDIT_FIX_PLAN.md、TODO.md、SPEC.md、DESKTOP_E2E_CHECKLIST.md、TEST_REPORT.md 与 PROGRESS.md 已校准为当前 V1.0 RC 收尾状态。
- 稳定官方 WebDriver 原生对话框验收：修复 Windows 选择器控件过滤、路径输入和目录刷新后的控件重解析，匹配 WebView2 151 的 EdgeDriver 复跑全部阶段标记与大文档 FPS。

## 未发布 - 2026-09-02

- 新增全局自定义右键菜单，统一替换应用内容区域的 WebView2 默认菜单，支持工作台、输入控件、链接、图片、正文树、编辑器、资料、附件、回收站、搜索、历史和规划条目。
- 新增剪贴板安全回退、CodeMirror 选区/光标菜单、Markdown 格式子菜单、AI 任务预选、搜索和导出范围 preset。
- 扩展插件菜单插槽与 ContextMenuPayload，旧 PluginMenuItem 注册方式继续兼容；新增菜单几何、交互、剪贴板和插件回归测试。
