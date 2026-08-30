# NovelForge 审计修复与 V1.0 收尾跟踪

状态：[ ] 未开始，[~] 进行中，[x] 完成，[!] 阻塞。

## 执行范围

本轮严格执行《NovelForge 审计修复与 V1.0 收尾计划.md》的 P1-01 至 P2-02。
每个阶段均须完成实现、相关自动测试、质量门禁、PROGRESS.md 更新和独立 Git 提交。

## P1 高优先级

- [x] P1-01 数据库恢复 UUID：为正文节点和资料镜像增加稳定元数据，兼容无元数据旧项目并验证关系、地点树和章节关联恢复。
- [x] P1-02 回收站路径复用：创建、复制、移动和恢复统一使用碰撞安全的节点路径分配。
- [x] P1-03 CodeMirror 选区编辑：实现选区/光标感知的 Markdown 格式命令和可重绑定的 Ctrl+B/Ctrl+I。
- [x] P1-04 Wiki 正文链接：预览和编辑模式均可导航，处理同名候选与缺失条目。
- [x] P1-05 一致性规则：补齐人物年龄、生日、死亡后出现、疑似拼写、性别、地点和时间线规则。
- [x] P1-06 导出格式保真：建立统一 Markdown 导出模型，提升 TXT、HTML、DOCX、EPUB、PDF 和封面处理。

## 后续跟踪

- [x] P2-01 AI 上下文：支持当前选区/段落、最近 N 章、指定章节与资料，并提供预算和选区结果应用。
- [x] P2-02 commands.rs 模块化
- [x] P2-03 CI
- [x] P2-04 大文件性能
- [x] P3-01 插件 API 设计
- [~] P3-02 桌面 E2E（release、官方 WebDriver 与原生对话框自动化已通过；FPS 和外部阅读器仍待人工确认）

## 质量门禁

- [x] P1 全部完成后运行 cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
- [x] P1 全部完成后运行 pnpm.cmd tauri:build
- [x] P1 全部完成后复核 DESKTOP_E2E_CHECKLIST.md、TODO.md、PROGRESS.md、TEST_REPORT.md
- [x] P2/P3 自动门禁：前端 63 项测试、Rust 33 项常规测试、1000 章/100 万字基准、release/NSIS 构建和启动冒烟
- [~] P3-02 人工门禁：CodeMirror FPS/滚动体感和六种导出文件在对应阅读器中的实际打开确认

## 记录

- 2026-08-30：读取收尾计划、产品规格、原始构建任务文档、TODO、PROGRESS、DECISIONS、CHANGELOG、TEST_REPORT 和桌面 E2E 清单；基线门禁通过。
- 2026-08-30：P1-01 完成；稳定 frontmatter、数据库重建和历史索引恢复测试通过，开始 P1-02。
- 2026-08-30：P1-02 完成；路径分配、回收站 sidecar、冲突恢复和永久删除测试通过，开始 P1-03。
- 2026-08-30：P1-03 完成；CodeMirror 选区 command、完整基础格式工具栏和可重绑定 Ctrl+B/Ctrl+I 测试通过，开始 P1-04。
- 2026-08-30：P1-04 完成；Wiki 链接在预览中可导航、编辑器中以 CodeMirror 装饰显示并支持 Ctrl/Cmd 点击，同名条目进入候选选择，缺失条目进入搜索；前后端代码围栏解析回归通过，开始 P1-05。
- 2026-08-30：P1-05 完成；前后端一致性检查新增结构化年龄/生日/性别冲突、死亡后时间线出现、疑似人物/地点名称变化、时间线逆序和时间范围校验；新增前后端回归测试，开始 P1-06。
- 2026-08-30：P1-06 完成；建立 Rust Markdown ExportDocument AST，统一渲染 TXT/HTML/DOCX/EPUB/PDF，覆盖标题、行内格式、引用、列表、任务、链接、Wiki、代码、分割线和表格；HTML data URI、EPUB/DOCX 封面资源与 EPUB 分章导航回归通过，进入 P1 全量门禁。
- 2026-08-30：P1 全量门禁完成；前端 typecheck/lint/test/build、Rust check/test、1000 章/100 万字 ignored 基准和 Tauri release/NSIS 构建均通过；release EXE 独立启动 4 秒并保持 Responding。桌面鼠标级 E2E 仍按清单保留为人工验收项。
- 2026-08-30：P2-01 完成；AI 面板接入 CodeMirror 选区和当前段落、最近 1/3/5/10 章、全量指定章节/人物/地点/世界观/笔记、字符/Token 预算及选区替换/插入，结果支持复制和 Esc 取消，前端 61 项测试通过，开始 P2-02。
- 2026-08-31：P2-02 完成阶段迁移；commands.rs 已成为 commands/mod.rs 兼容入口，AI、搜索、统计实现已迁移到独立模块，项目/正文/资料/恢复/回收站/一致性/导出及 storage/database、filesystem、migration 领域边界已建立；cargo check、cargo test（32 项常规 + 1 项 ignored）通过。
- 2026-08-31：P2-03 完成；新增 .github/workflows/ci.yml，在 main 的 push/PR 上执行 pnpm install --frozen-lockfile、typecheck、lint、test、build 及 cargo check/test。
- 2026-08-31：P2-04 完成；新增 10 万中文单章真实命令链测试，覆盖打开、编辑、插入、删除、搜索、保存和重开，定向测试通过 1/1（约 0.13 秒）；WebView2/CodeMirror FPS 仍列入桌面人工清单。
- 2026-08-31：P3-01 完成；新增 docs/PLUGIN_API.md、进程内 PluginRegistry 和六类扩展点，内置名字生成器与一致性检查通过注册协议接入；明确 V1.0 不加载或执行任意外部 JavaScript，前端 63 项测试通过。
- 2026-08-31：P3-02 完成 release 预检；pnpm.cmd tauri:build 重新生成 release EXE/NSIS，独立 EXE 启动 4 秒保持 Responding=True 后正常退出；tauri-driver、msedgedriver 均未安装，真实 WebView2 鼠标级 E2E 未将预检冒充完成。
- 2026-08-31：最终自动门禁复核；pnpm.cmd typecheck/lint/test/build 全部通过（13 个测试文件 / 63 项），cargo test 33 项常规通过，ignored 大型基准 54.60 秒通过；除用户提供的收尾计划文件外工作区无代码改动。
- 2026-08-31：P3-02 CDP 自动化初版；新增 scripts/desktop-e2e-cdp.mjs 与 pnpm test:e2e:desktop，release WebView2 实际跑通核心编辑器/正文树、历史 Diff/恢复、节重命名、跨卷复制/移动、资料 CRUD、规划视图、搜索、AI 选区/最近章节/Esc 取消/Provider、回收站恢复和六种导出生成及内容断言；随后在下方记录中补齐了官方 WebDriver、原生对话框和恢复重启流程。
- 2026-08-31：P3-02 桌面流程自动化收尾；新增真实应用重启后的保存失败/恢复提示、拖拽与批量恢复、Wiki 导航、设置/命令面板流程，并通过官方 tauri-driver + 与 WebView2 151 匹配的 msedgedriver 运行原生文件夹/文件选择器和系统对话框（CORE_EDITOR_TREE_OK、DRAG_DROP_OK、HISTORY_AND_TREE_ACTIONS_OK、ENTITY_CRUD_OK、WIKI_NAVIGATION_OK、SETTINGS_COMMANDS_OK、RECOVERY_FAILURE_OK、NATIVE_DIALOGS_OK、PLANNING_AND_CHECKS_OK、SEARCH_OK、AI_SELECTION_AND_CANCEL_OK、AI_PROVIDER_OK、TRASH_RESTORE_OK、EXPORTS_OK）。剩余门禁仅为 CodeMirror FPS/滚动体感及在 Word/WPS、LibreOffice/Calibre、Sumatra/Acrobat 等对应阅读器中实际打开六种导出文件并记录人工结果。
- 2026-08-31：最终门禁重跑（代码提交 83fe730）；pnpm.cmd typecheck、lint、test -- --run、build，cargo check、cargo test 和 1000 章/100 万字 ignored 基准（52.72 秒）全部通过；重新生成 release EXE/NSIS，独立 EXE Responding=True；直连 CDP 与官方 WebDriver + 原生对话框桌面 E2E 均通过。P3-02 仅保留 FPS/阅读器人工门禁。
- 2026-08-31：阅读器冒烟补充；使用 Windows 记事本打开 Markdown/TXT、Edge 打开 HTML/PDF、LibreOffice Portable Writer 打开 DOCX、Calibre Portable eBook Viewer 打开 EPUB，并记录窗口标题、可访问文本或转换结果；逐页视觉核对与 CodeMirror FPS/滚动体感仍保留为人工签核，不将冒烟证据标记为完成。
- 2026-08-31：新增可选大文档桌面采样；直连 release WebView2 2 秒 286 帧（约 142.8 FPS），官方 WebDriver + 原生对话框模式 2 秒 278 帧（约 139.0 FPS），均确认真实 editor-pane overflow 容器和 100,000 字以上分块注入/保存；滚动输入主观体感及逐页导出视觉仍待人工签核。
- 2026-08-31：新增带测试封面的可复现导出夹具（commit 0710bbd）；直连 E2E 保留项目目录并由记事本、Edge、LibreOffice Portable、Calibre Portable、SumatraPDF 完成加载复核，DOCX/EPUB 归档确认封面资源存在；截图不可用，视觉门禁仍保持未完成。
