# 测试报告

## 当前轮次

- 测试时间：2026-08-26
- 环境：Windows 11 x64，Node 24.18.1，npm 11.16.0，pnpm 11.19.0，Rust 1.97.1，目标 `x86_64-pc-windows-msvc`

## 结果

| 层级 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| Unit + integration | `pnpm test` | 通过：2 文件 / 7 测试；覆盖 Markdown 提示、标点转换、统计、名字生成、防抖、项目创建/保存/搜索/导出/回收站 |
| Type | `pnpm typecheck` | 通过 |
| Lint | `pnpm lint` | 通过：0 error / 0 warning |
| Frontend build | `pnpm build` | 通过：Vite 生产产物写入 `dist/` |
| Rust unit | `cargo test --manifest-path src-tauri/Cargo.toml` | 通过：4 测试；覆盖原子替换、路径穿越拒绝、FTS5 初始化、资料 Markdown 镜像 |
| Rust compile | `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| Tauri dev | `pnpm tauri dev` | 通过：Vite 就绪且 `target/debug/novelforge.exe` 实际启动；监听范围排除了 Rust target |
| Windows package | `pnpm run tauri:build` | 通过：Windows x64 EXE + NSIS 安装包 |
| Release smoke | 启动 `src-tauri/target/release/novelforge.exe` | 通过：进程启动并由本轮检查正常退出 |

## 数据安全证据

- 项目初始化创建 `project.json`、`manuscript/`、资料目录和 `.novelforge/`。
- 正文保存先写 `.novelforge/recovery/` 和同目录临时文件，再替换正式 Markdown、写入历史快照和搜索索引；失败时恢复文件不会被清理。
- 删除正文或资料先移动到项目 `trash/` 并记录 SQLite 回收站条目。
- API Key 未在本版本保存、日志或请求链路中出现；AI 模块尚未启用。

## 未覆盖 / 后续

- 尚未完成真实桌面 UI 的鼠标级 E2E（创建完整大规模测试小说、崩溃中断后交互恢复）；已完成开发窗口和 release 进程级冒烟。
- AI、DOCX/EPUB/PDF、关系图、命令面板及 1000 章性能验收属于后续版本。
- Rust 有 3 个非致命 dead_code 警告；Vite 报告主 bundle 超过 500 kB。

## V0.2 写作规划验证（2026-08-29）

### 本轮范围

- 章节大纲按章节关联与保存。
- 场景卡创建、编辑、拖拽排序及上下移动。
- 章节看板状态拖拽、状态下拉修改和正文跳转。
- 规划数据排序、重排以及浏览器 fallback 持久化。

### 结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，4 个测试文件、10 个测试。
- `pnpm build`：通过；规划组件已打入生产前端。

### 未覆盖 / 后续

- 尚未完成 Tauri 桌面鼠标级 E2E、发布版构建和大规模性能验收。
- 时间线 / 伏笔专用视图、人物关系图、命令面板和 AI Provider 尚未实现。

## V0.2 后续能力验证（2026-08-30）

### 本轮范围

- 人物关系图和关系实体的本地持久化、SVG 网络布局与人物跳转。
- 命令面板搜索、键盘导航、快捷键录制、冲突提示和默认值恢复。
- Wiki / 章节引用 / 重复资料 / 关系引用 / 伏笔状态一致性检查。
- 桌面附件导入、二进制保护、回收站兼容，以及近 30 日统计和章节排行。

### 结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，7 个测试文件、24 个测试。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，13 个 Rust 测试。

### 未覆盖 / 后续

- DOCX / EPUB / PDF、多 Provider AI 辅助、桌面鼠标级 E2E 和 1000 章 / 100 万字性能验收仍待后续阶段。
