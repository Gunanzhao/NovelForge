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