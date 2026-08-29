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

## 多格式导出验证（2026-08-30）

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，7 个测试文件、24 个测试。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，14 个 Rust 测试；覆盖五种导出格式、ZIP 内容和无效格式拒绝。

## AI Provider 与上下文辅助验证（2026-08-30）

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，8 个测试文件、26 个测试；覆盖本地 AI 草稿、上下文拼接、偏好不保存 API Key。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，16 个 Rust 测试；包含本地模拟 OpenAI-compatible 响应解析。

## 最终验收（2026-08-30）

### 自动化结果

| 层级 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| Frontend tests | `pnpm.cmd test` | 通过：9 个测试文件 / 28 个测试 |
| Type + lint | `pnpm.cmd typecheck`、`pnpm.cmd lint` | 均通过；Lint 0 error / 0 warning |
| Frontend build | `pnpm.cmd build` | 通过；Vite 主 bundle 约 1.15 MB，保留体积提示 |
| Rust unit | `cargo test --manifest-path src-tauri/Cargo.toml` | 通过：16 个测试，1 个 ignored |
| Large-project acceptance | `cargo test --manifest-path src-tauri/Cargo.toml large_project_acceptance_handles_1000_chapters_and_one_million_characters -- --ignored --nocapture` | 通过：1000 章、统计字数不少于 1,000,000，37.19 秒 |
| Windows package | `pnpm.cmd tauri:build` | 通过：release EXE + NSIS 安装包 |
| Release smoke | 启动 `src-tauri/target/release/novelforge.exe` | 通过：实际 release 进程启动并正常结束 |

### 未覆盖 / 需人工

- 当前环境未安装 `tauri-driver`、`geckodriver`、`chromedriver` 或 Playwright，无法可靠执行真实桌面鼠标级 E2E。
- 请在 Windows + WebView2 桌面上按 [`DESKTOP_E2E_CHECKLIST.md`](DESKTOP_E2E_CHECKLIST.md) 完成创建项目、编辑保存、资料 CRUD、导出、回收站恢复、AI 本地模式和异常恢复的人工验收。
- Rust 的 3 个 dead-code 警告、Vite 主 bundle 体积提示和 PDF 标准字体兼容性属于非阻塞项。

## 规格差距补齐验证（2026-08-30）

* 节点移动/复制：通过 Rust 真实文件系统集成测试，跨卷移动会同步章节小节目录和数据库路径，复制会生成独立 ID 与文件副本。
* 拖拽排序与批量选择：通过 TypeScript 类型检查、Lint 和前端回归测试。
* Ctrl+P 快速打开、Ctrl+F 当前文档搜索、Ctrl+Shift+F 全项目搜索及全资料类型筛选：通过前端回归测试。
* HTML 和范围导出：通过 Rust 导出测试；Markdown/TXT/HTML/DOCX/EPUB/PDF 均生成成功。
* AI 扩展：通过前端回归测试；Provider 名称、Temperature、Max Tokens 仅保存非敏感偏好，API Key 仍不写入持久化。
* 回归结果：pnpm.cmd test 40/40；pnpm.cmd typecheck 通过；pnpm.cmd lint 0 error / 0 warning；cargo test 17 passed、1 ignored。
* 发布结果：pnpm.cmd tauri:build 通过；release EXE 和 NSIS 安装包实际生成；release EXE 独立启动冒烟通过。

### 仍需人工

* 真实桌面鼠标级 E2E（窗口内点击、输入、创建项目、完整导出/恢复和异常恢复）仍需在带 WebView2 的 Windows 桌面执行；当前环境未安装桌面自动化驱动。

## 最终收尾验证（2026-08-30）

本轮补齐资料自定义字段和地点树、作品/卷/章节三级大纲、时间线标签、伏笔部分回收、Wiki 反向引用、正文树窗口化渲染、保存事务回滚、损坏数据库 Markdown 重建、分级脱敏日志和 TXT 纯文本清理。

| 层级 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| Frontend tests | pnpm.cmd test -- --run | 通过：12 个测试文件 / 40 个测试 |
| Type + lint | pnpm.cmd typecheck、pnpm.cmd lint | 均通过；Lint 0 error / 0 warning |
| Frontend build | pnpm.cmd build | 通过；主 bundle 约 1.20 MB，保留体积提示 |
| Rust unit | cargo test --manifest-path src-tauri/Cargo.toml | 通过：20 个测试，1 个 ignored |
| Data safety | 保存事务失败、损坏 SQLite 重建、日志脱敏、Wiki FTS 反向查询 | 全部通过 |
| Large-project acceptance | 10 volumes, 1000 chapters, 1,000,000 characters, 100 characters, 100 locations, 200 world entries, 500 timeline events, 100 foreshadowings | 通过：53.94 秒；重新打开、统计和资料搜索均通过 |
| Windows package | pnpm.cmd tauri:build | 通过：release EXE 与 NSIS 安装包 |
| Release smoke | 启动 target/release/novelforge.exe | 通过：独立进程存活 4 秒后正常退出 |

### 当前未覆盖

- 真实桌面鼠标级 E2E 仍需用户在带 WebView2 的 Windows 桌面按 DESKTOP_E2E_CHECKLIST.md 手动完成。
- PDF 当前使用标准 STSong-Light CID 字体，跨阅读器视觉一致性仍可作为后续质量优化。

## 质量收尾验证（2026-08-30）

- Rust cargo check：通过，已无 dead-code 警告；cargo test 通过 20 项（1 项大型基准 ignored）。
- 正文读取安全回归：缺失正文文件会返回明确错误而不会静默返回空内容；Rust 常规测试更新为 23 项通过（1 项大型基准 ignored）。
- 节点与资料写入回滚回归：新建、重命名、资料镜像在数据库失败时均恢复原文件并避免孤立记录。
- pnpm.cmd build：通过；React、CodeMirror、Markdown 和图标依赖已分包，最大 chunk 约 364 kB，未出现体积警告。
- 浏览器 fallback 回归：路径层级、递归删除/恢复、资料快照和二进制导出边界均覆盖；前端测试总数更新为 41 项。
- 当前仍需人工的唯一功能验收门槛是带 WebView2 的 Windows 桌面鼠标级 E2E。

## 最新 release 重验（2026-08-30）

- pnpm.cmd tauri:build：通过；release EXE 15,173,632 bytes，NSIS 安装包 4,273,662 bytes。
- release EXE 独立进程存活 4 秒且响应正常；分包后的 WebView2 页面目标加载成功（标题 NovelForge，URL tauri.localhost）。
