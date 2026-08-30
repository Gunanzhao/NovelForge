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
| Large-project acceptance | 10 volumes, 1000 chapters, 1,000,000 characters, 100 characters, 100 locations, 200 world entries, 500 timeline events, 100 foreshadowings | 通过：51.19 秒；重新打开、统计和资料搜索均通过 |
| Windows package | pnpm.cmd tauri:build | 通过：release EXE 与 NSIS 安装包 |
| Release smoke | 启动 target/release/novelforge.exe | 通过：独立进程存活 4 秒后正常退出 |

### 当前未覆盖

- 真实桌面鼠标级 E2E 仍需用户在带 WebView2 的 Windows 桌面按 DESKTOP_E2E_CHECKLIST.md 手动完成。
- PDF 当前使用标准 STSong-Light CID 字体，跨阅读器视觉一致性仍可作为后续质量优化。

## 质量收尾验证（2026-08-30）

- Rust cargo check：通过，已无 dead-code 警告；cargo test 通过 20 项（1 项大型基准 ignored）。
- 正文读取安全回归：缺失正文文件会返回明确错误而不会静默返回空内容；Rust 常规测试更新为 23 项通过（1 项大型基准 ignored）。
- 节点与资料写入回滚回归：新建、重命名、资料镜像在数据库失败时均恢复原文件并避免孤立记录。
- fallback 输入边界回归：重复项目、空标题、无效状态和不存在删除目标均返回明确错误；前端测试总数更新为 42 项。
- pnpm.cmd build：通过；React、CodeMirror、Markdown 和图标依赖已分包，最大 chunk 约 364 kB，未出现体积警告。
- 浏览器 fallback 回归：路径层级、递归删除/恢复、资料快照和二进制导出边界均覆盖；前端测试总数更新为 41 项。
- 当前仍需人工的唯一功能验收门槛是带 WebView2 的 Windows 桌面鼠标级 E2E。

## 最新 release 重验（2026-08-30）

- pnpm.cmd tauri:build：通过；release EXE 15,187,968 bytes，NSIS 安装包 4,275,768 bytes。
- release EXE 独立进程存活 4 秒且响应正常；分包后的 WebView2 页面目标加载成功（标题 NovelForge，URL tauri.localhost）。

## 多卷章节引用与排序验证（2026-08-30）

- 前端新增跨卷章节排序和引用解析回归：先按卷顺序，再按卷内章节顺序；44 项前端测试全部通过。
- Rust 一致性检查改为使用完整正文树解析全局章节引用；24 项常规 Rust 测试全部通过，1 项大型基准按设计忽略。
- 真实多卷命令链覆盖：创建第二卷、创建卷内章节、保存时间线章节引用并执行一致性检查，未产生错误章节引用。

### 当前仍需人工

- 仅剩真实桌面鼠标级 E2E：需在 Windows + WebView2 中按 DESKTOP_E2E_CHECKLIST.md 逐项点击验收；当前环境没有可靠的桌面自动化驱动。
- PDF 的 STSong-Light 标准 CID 字体跨阅读器视觉一致性仍属于非阻塞质量优化。

## 多卷修复 release 重建（2026-08-30）

- pnpm.cmd tauri:build：通过；release EXE 15,192,576 bytes，NSIS 安装包 4,280,566 bytes。
- 独立 release EXE 启动 4 秒后仍存活且 Responding 为 True，测试后按 PID 正常退出。

## fallback 指定章节导出验证（2026-08-30）

- 浏览器 fallback 指定章节导出覆盖选中章节正文和递归小节，不再因缺少卷根节点而生成空正文。
- 缺少章节 ID、卷路径或不存在目标均返回明确错误；正文内容回归已加入 fallback 集成测试。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：全部通过，12 个测试文件 / 44 个测试。

## fallback 正文编辑边界验证（2026-08-30）

- 章节重命名后 Markdown 一级标题同步更新；卷节点读取/保存被明确拒绝。
- 历史恢复保留恢复前快照，并更新正文、统计和节点时间。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：全部通过，12 个测试文件 / 45 个测试。

## fallback 资料与设置边界验证（2026-08-30）

- 资料条目跨类型修改和回收站 ID 复用均被拒绝；标签格式无效时拒绝写入。
- 项目设置拒绝空作品名和负目标字数，并规范化字符串和小数目标值。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：全部通过，12 个测试文件 / 47 个测试。
- release EXE 独立启动 4 秒后仍 Responding 为 True；EXE 与 NSIS 已重新生成。

## 节点状态与输入边界验证（2026-08-30）

- 桌面节点状态对不存在节点返回明确错误；排序更新使用 SQLite 事务。
- fallback 创建项目、复制/移动节点和资料写入的无效数值、标题、标签输入均被拒绝。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：全部通过，12 个测试文件 / 48 个测试。
- cargo check、cargo test：通过，25 项 Rust 常规测试，1 项大型基准按设计忽略。

## fallback 运行时载荷验证（2026-08-30）

- 父节点、目标顺序、搜索参数、正文原因和资料内容的错误类型均返回明确错误，不写入非法 fallback 数据。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：全部通过，12 个测试文件 / 49 个测试。

## 伏笔待跟进统计验证（2026-08-30）

- 伏笔总览的待跟进计数排除已回收和废弃状态；部分回收仍计入待跟进。
- planning 状态语义回归通过；前端 49 项测试全部通过。

## 最终验收复核（2026-08-30）

- 大型验收基准再次通过：1 passed、0 failed；10 卷、1000 章、100 万字和资料数据命令链耗时 51.08 秒。
- 最新 release 产物：E:\\NOVELFORGE\\src-tauri\\target\\release\\novelforge.exe（15,193,600 bytes）和 E:\\NOVELFORGE\\src-tauri\\target\\release\\bundle\\nsis\\NovelForge_0.1.0_x64-setup.exe（4,284,094 bytes）。
- 当前唯一未完成的是桌面人工鼠标级 E2E；它需要真实 Windows + WebView2 窗口操作。

## 首章选择逻辑验证（2026-08-30）

- 新建、打开项目和删除节点后的自动跳转只选择章节，不会把小节误当成首章。
- planning-data 跨卷排序和 app-store 状态流回归通过；前端测试达到 50 项。

## 正文树排序入口验证（2026-08-30）

- 写作规划初始章节、AI 上下文和快速打开均按跨卷章节顺序展示，小节紧随所属章节。
- planning-data 正文树层级排序回归通过；前端测试达到 51 项。

## 章节标题引用解析验证（2026-08-30）

- 章节引用列表不再按空格拆分，带空格和破折号的完整章节标题可直接匹配；逗号、分号和换行仍可分隔多个引用。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：全部通过，12 个测试文件 / 53 个测试。
- cargo check、cargo test：通过，25 项 Rust 常规测试，1 项大型基准按设计忽略。

## 最新 release 定向回归（2026-08-30）

- pnpm.cmd tauri:build：通过；release EXE 15,193,600 bytes，NSIS 安装包 4,279,554 bytes。
- 通过真实 WebView2/Tauri 命令桥接创建“第二章 - CDP”并写入时间线引用；一致性检查返回 0 个问题。
- release 重新打开项目后仍可读出章节与时间线数据，临时 E2E 项目已清理。

## 伏笔旧状态兼容验证（2026-08-30）

- 前后端一致性检查均按规范化状态识别 resolved、paid_off 等历史“已回收”别名。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：全部通过，12 个测试文件 / 54 个测试。
- cargo check、cargo test：通过，26 项 Rust 常规测试，1 项大型基准按设计忽略。

## 最新伏笔兼容 release（2026-08-30）

- pnpm.cmd tauri:build：通过；release EXE 15,196,672 bytes，NSIS 安装包 4,277,716 bytes。
- 独立启动 release EXE 4 秒后仍存活且 Responding 为 True，验证后正常退出。

## PDF 导出标题验证（2026-08-30）

- PDF 页面文本先经过 Markdown 纯文本清理，标题不再显示 #、## 等语法标记。
- Rust 导出全格式回归通过，PDF 字节断言确认没有暴露 Markdown 标题标记。

## HTML 导出结构验证（2026-08-30）

- HTML 页面只保留一份作品标题和一份目录，正文树标题仍按层级输出。
- Rust 导出全格式回归通过，新增标题/目录去重断言。

## 导出结构与视觉复核（2026-08-30）

- 最新 release 实际生成 HTML/PDF 后，HTML 标题/目录计数均为 1，PDF 渲染页无 Markdown 标题标记。
- DOCX ZIP、word/document.xml、Heading 样式和中文文本结构校验通过；render_docx.py 因本机缺少 LibreOffice 未能生成 PNG，未将此环境限制误判为导出失败。

## 最终全量质量门禁复核（2026-08-30）

- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；12 个测试文件 / 54 项测试。
- cargo check、cargo test 全部通过；26 项 Rust 常规测试，1 项大型基准按设计忽略。
- 1000 章 / 100 万字大型基准通过，耗时 51.86 秒；release 产物存在且工作区干净。

## P1-01 数据库恢复 UUID 验证（2026-08-30）

- 新建、保存、重命名、移动和复制产生/维护稳定 Markdown frontmatter；编辑器和统计只读取纯正文。
- 损坏 SQLite 后恢复原卷、章、节、人物关系、地点 parentId、章节大纲/场景 chapterId 和历史快照索引。
- 无 frontmatter 的旧项目仍可恢复，生成新 UUID，并在项目日志写入 database_recovery_legacy_metadata WARN。
- cargo test：28 项常规测试通过，1 项大型基准按设计忽略；新增稳定关联和旧格式兼容测试均通过。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：12 个测试文件 / 54 项测试全部通过。

## P1-02 回收站路径复用验证（2026-08-30）

- 路径分配同时检查活动/删除节点记录、实际文件和章节 sidecar；创建替代章节不会复用已删除原路径。
- 删除、恢复和永久删除章节时 sidecar 与正文保持一致；恢复冲突时路径和兄弟顺序均保持唯一。
- cargo test：29 项常规测试通过，1 项大型基准按设计忽略；新增路径复用集成测试通过。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：12 个测试文件 / 54 项测试全部通过。

## P1-03 CodeMirror 选区编辑验证（2026-08-30）

- 选区/光标 Markdown command 覆盖粗体、斜体、删除线、代码、标题、引用、列表、链接、图片和分割线；编辑通过 CodeMirror transaction 更新。
- Ctrl+B/Ctrl+I 已进入可重绑定命令注册表；普通输入框不会被编辑器快捷键拦截。
- 前端回归：12 个测试文件 / 56 项测试全部通过；包含 Unicode、多行和取消格式测试。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；cargo check、cargo test 全部通过（29 项常规 + 1 项 ignored）。
## P1-04 Wiki 正文链接验证（2026-08-30）

- Wiki 双括号条目会转换为可拦截的内部 Markdown href；预览支持唯一条目跳转、同名候选选择和缺失目标搜索。
- 编辑模式通过 CodeMirror mark 装饰显示 Wiki 链接，Ctrl/Cmd 点击进入同一解析流程；辅助栏对同名条目不再静默取首个。
- 前后端解析均跳过 fenced code block；前端 helper 回归覆盖编码 href 往返、代码围栏和目标提取，Rust 回归覆盖一致性检查。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：通过，12 个测试文件 / 57 项测试。
- cargo check、cargo test：通过，30 项 Rust 常规测试，1 个大型基准按设计忽略。
