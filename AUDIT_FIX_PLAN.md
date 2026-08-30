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
- [ ] P3-01 插件 API 设计
- [ ] P3-02 桌面 E2E

## 质量门禁

- [x] P1 全部完成后运行 cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
- [x] P1 全部完成后运行 pnpm.cmd tauri:build
- [x] P1 全部完成后复核 DESKTOP_E2E_CHECKLIST.md、TODO.md、PROGRESS.md、TEST_REPORT.md

## 记录

- 2026-08-30：读取收尾计划、产品规格、原始构建任务文档、TODO、PROGRESS、DECISIONS、CHANGELOG、TEST_REPORT 和桌面 E2E 清单；基线门禁通过。
- 2026-08-30：P1-01 完成；稳定 frontmatter、数据库重建和历史索引恢复测试通过，开始 P1-02。
- 2026-08-30：P1-02 完成；路径分配、回收站 sidecar、冲突恢复和永久删除测试通过，开始 P1-03。
- 2026-08-30：P1-03 完成；CodeMirror 选区 command、完整基础格式工具栏和可重绑定 Ctrl+B/Ctrl+I 测试通过，开始 P1-04。
- 2026-08-30：P1-04 完成；Wiki 链接在预览中可导航、编辑器中以 CodeMirror 装饰显示并支持 Ctrl/Cmd 点击，同名条目进入候选选择，缺失条目进入搜索；前后端代码围栏解析回归通过，开始 P1-05。
- 2026-08-30：P1-05 完成；前后端一致性检查新增结构化年龄/生日/性别冲突、死亡后时间线出现、疑似人物/地点名称变化、时间线逆序和时间范围校验；新增前后端回归测试，开始 P1-06。
- 2026-08-30：P1-06 完成；建立 Rust Markdown ExportDocument AST，统一渲染 TXT/HTML/DOCX/EPUB/PDF，覆盖标题、行内格式、引用、列表、任务、链接、Wiki、代码、分割线和表格；HTML data URI、EPUB/DOCX 封面资源与 EPUB 分章导航回归通过，进入 P1 全量门禁。
- 2026-08-30：P1 全量门禁完成；前端 typecheck/lint/test/build、Rust check/test、1000 章/100 万字 ignored 基准和 Tauri release/NSIS 构建均通过；release EXE 独立启动 4 秒并保持 Responding。桌面鼠标级 E2E 仍按清单保留为人工验收项。
- 2026-08-30：P2-01 完成；AI 面板接入 CodeMirror 选区和当前段落、最近 1/3/5/10 章、全量指定章节/人物/地点/世界观/笔记、字符/Token 预算及选区替换/插入，前端 61 项测试通过，开始 P2-02。
- 2026-08-31：P2-02 完成阶段迁移；commands.rs 已成为 commands/mod.rs 兼容入口，AI、搜索、统计实现已迁移到独立模块，项目/正文/资料/恢复/回收站/一致性/导出及 storage/database、filesystem、migration 领域边界已建立；cargo check、cargo test（32 项常规 + 1 项 ignored）通过。
- 2026-08-31：P2-03 完成；新增 .github/workflows/ci.yml，在 main 的 push/PR 上执行 pnpm install --frozen-lockfile、typecheck、lint、test、build 及 cargo check/test。
- 2026-08-31：P2-04 完成；新增 10 万中文单章真实命令链测试，覆盖打开、编辑、插入、删除、搜索、保存和重开，定向测试通过 1/1（约 0.13 秒）；WebView2/CodeMirror FPS 仍列入桌面人工清单。
