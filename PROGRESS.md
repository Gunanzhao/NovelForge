# 开发进度

## 2026-08-26：Phase 1 + MVP 核心实现

### 完成内容

- 从空目录初始化 Tauri 2、React、TypeScript、Vite 工程。
- 建立 Rust SQLite 数据层和本地文件命令：项目、树节点、资料条目、搜索、统计、导出、回收站、恢复与历史。
- 完成桌面三栏写作界面、CodeMirror 编辑器、Markdown 预览、资料面板、搜索和状态栏。
- 完成自动保存链路：防抖保存、恢复文件、临时文件、历史快照；正文始终落在项目 Markdown 文件。
- 完成人物、地点、世界观、时间线和伏笔的统一资料卡入口，以及 Wiki 链接识别和本地规则名字生成器。
- 增加浏览器开发模式 localStorage fallback，便于没有 Tauri 窗口时验收 UI 和核心交互。

### 验证结果

- `pnpm install --no-frozen-lockfile`：依赖安装成功；pnpm 仅拦截 esbuild 构建脚本，按最小范围批准 esbuild 后恢复脚本检查。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，2 个测试文件、7 个测试。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，4 个 Rust 数据安全测试。
- `pnpm build`：通过，生成 `dist/` 前端产物。
- `pnpm tauri dev`：通过；Vite 在 `http://localhost:1420/` 就绪，Tauri debug EXE 实际启动。Vite 监听已排除 `src-tauri/**`，避免 Windows 锁定 DLL 触发 watcher 错误。
- `pnpm run tauri:build`：通过，生成 Windows x64 release EXE 和 NSIS 安装包。
- release EXE 冒烟检查：进程可启动，检查后已正常退出。

### 产物

- `src-tauri/target/release/novelforge.exe`
- `src-tauri/target/release/bundle/nsis/NovelForge_0.1.0_x64-setup.exe`

### 已知问题

- 当前未实现远程 AI Provider、DOCX/EPUB/PDF、复杂命令面板、完整人物关系图和 1000 章 / 100 万字性能验收。
- SQLite FTS5 对中文采用 FTS5 与 Unicode 内容回退组合，后续可增加更细的中文分词索引。
- release 构建仍有 Rust 未使用字段警告和 Vite 大 bundle 提示，不影响本轮运行和构建。

### 下一步

- 按 V0.2 增加场景卡、章节看板、人物关系图和命令注册接口；再接入可选 AI Provider 与显式上下文预览。

## 2026-08-29：V0.2 写作规划第二阶段

### 完成内容

- 新增时间线专用工作区：按故事日期和时间排序事件，支持搜索、CRUD、人物 / 地点记录和章节引用跳转。
- 新增伏笔专用工作区：按待埋设、已埋设、已回收、已搁置筛选，支持快捷改状态、CRUD、章节引用跳转和待跟进数量统计。
- 将日期排序、中文时段排序、章节号解析和伏笔状态归一化提取为可测试的规划数据工具。
- 补充浏览器 fallback 的时间线 / 伏笔持久化集成测试，以及 Rust 删除事务失败回滚、恢复目标冲突保护测试。

### 修改文件

- `src/components/TimelineView.tsx`
- `src/components/ForeshadowingView.tsx`
- `src/App.tsx`、`src/lib/planning-data.ts`、`src/planning.css`
- `tests/planning.test.ts`、`tests/planning.integration.test.ts`
- `src-tauri/src/rust_tests.rs`

### 验证结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，5 个测试文件、17 个测试。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，10 个 Rust 测试。
- `pnpm build`：通过，时间线和伏笔视图进入 Vite 生产产物。
- `pnpm tauri:build`：通过，生成 Windows x64 release EXE 和 NSIS 安装包；release EXE 已启动并正常退出。

### 已知问题

- 仍需真实桌面鼠标级 E2E 和 1000 章 / 100 万字性能验收。
- 人物关系图、命令面板、AI Provider、一致性检查和 DOCX / EPUB / PDF 导出仍待后续版本。

### 下一步

- 先完成桌面 release 冒烟与异常场景 E2E，再进入人物关系图和命令面板设计。

## 2026-08-30：V0.2 写作规划第三阶段

### 完成内容

- 新增人物关系图工作区：关系实体持久化到 `relationships/`，提供 SVG 关系网络、人物节点跳转、关系类型 / 强度 / 备注和回收站删除。
- 新增命令面板：支持 `Ctrl+K` 搜索、键盘上下选择、Enter 执行，以及快捷键录制、冲突提示和恢复默认绑定。
- 将关系图布局、关系内容解析和快捷键解析提取为可测试工具；补充关系实体 fallback 集成测试。

### 验证结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，6 个测试文件、22 个测试。

### 已知问题

- 桌面鼠标级 E2E、1000 章 / 100 万字性能验收仍待完成。
- AI Provider、规则一致性、资料附件和 DOCX / EPUB / PDF 导出仍待后续阶段。

### 下一步

- 进入一致性检查、资料附件 / 研究资料和高级统计阶段。

## 2026-08-30：V0.2 写作规划第四阶段

### 完成内容

- 增加一致性检查命令和工作区：检测缺失 Wiki、无效章节引用、重复资料、断开人物关系以及伏笔状态不一致，并支持定位。
- 增加桌面附件导入：通过系统文件选择器将素材复制到项目 `attachments/`，记录类型 / 大小 / 说明，编辑说明不会覆盖二进制文件，删除继续走回收站。
- 扩展统计数据：返回近 30 日写作趋势和章节字数排行，新增详细统计工作区。
- 为一致性、附件二进制保护、统计序列和 fallback 命令增加前后端测试。

### 验证结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，7 个测试文件、24 个测试。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，13 个 Rust 测试。

### 已知问题

- DOCX / EPUB / PDF 导出、AI Provider、桌面鼠标级 E2E 和 1000 章 / 100 万字性能验收仍待后续阶段。
- SQLite FTS5 仍使用 Unicode 内容回退，尚未接入专门中文分词器。

### 下一步

- 先实现多格式导出，再接入可选 AI Provider 和显式上下文预览。

## 2026-08-30：V0.2 写作规划第五阶段

### 完成内容

- 导出对话框支持 Markdown、TXT、DOCX、EPUB 和 PDF 五种格式。
- Rust 生成 DOCX/EPUB ZIP 文档（含 EPUB 导航）和可分页 PDF；所有文件写入项目 `.novelforge/exports/`。
- 对导出格式、DOCX/EPUB 文件结构和 PDF 文件头增加回归测试，浏览器 fallback 返回对应格式占位路径。

### 验证结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，7 个测试文件、24 个测试。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，14 个 Rust 测试。

### 已知问题

- PDF 使用系统标准字体，缺少字体嵌入时复杂中文字体的渲染效果需在目标阅读器复核。
- AI Provider、桌面鼠标级 E2E 和 1000 章 / 100 万字性能验收仍待后续阶段。

### 下一步

- 实现可选 AI Provider、上下文预览和不依赖 API Key 的本地辅助流程。
## 2026-08-29：V0.2 写作规划第一阶段

### 完成内容

- 增加“写作规划”入口，内部提供章节大纲、场景卡和写作看板三个工作区。
- 大纲按章节关联，支持目标、冲突、重要事件、结果和备注，并保存为本地资料 Markdown 镜像。
- 场景卡支持 POV、地点、时间、参与人物、目标、冲突、结果和备注，支持拖拽及上下移动排序。
- 看板复用章节状态，支持拖拽到列或使用状态下拉框更新状态，并可点击卡片进入正文。
- 新增规划数据排序/重排工具和浏览器 fallback 规划实体集成测试。

### 修改文件

- `src/components/PlanningView.tsx`
- `src/components/OutlineView.tsx`
- `src/components/SceneView.tsx`
- `src/components/KanbanView.tsx`
- `src/lib/planning-data.ts`
- `src/planning.css`
- `tests/planning.test.ts`、`tests/planning.integration.test.ts`

### 验证结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，4 个测试文件、10 个测试。
- `pnpm build`：通过；规划页面已进入 Vite 生产产物。

### 已知问题

- 尚未完成真实桌面鼠标级 E2E、1000 章 / 100 万字性能验收和本阶段 Tauri release build。
- 时间线、伏笔专用管理视图、人物关系图和命令面板仍待后续阶段。

### 下一步

- 完成桌面 E2E 与数据安全异常测试，再开发时间线 / 伏笔专用视图。
