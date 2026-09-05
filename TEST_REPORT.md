# 测试报告

> 当前开发候选目标：`1.1.0-rc.3`（候选源码完成、本地产物已验收，未发布）。既有已发布安装包为 `NovelForge_1.1.0-rc.2_x64-setup.exe`；当前工作区源码不等同于该安装包。版本文件已升级 rc.3。
>
> rc.1/rc.2 的测试、benchmark、CI、tag 和发布记录属于各自历史版本，不作为 rc.3 通过证据。rc.3 最终数据统一见 [测试报告](TEST_REPORT.md#rc3-validation) 与 [发布清单](RELEASE_CHECKLIST.md#rc3-checklist)；全部本地门禁已通过，源码基线 CI 已通过。

<a id="rc3-validation"></a>

## V1.1.0-rc.3 当前验收（本地验收完成，源码基线 CI 通过，未发布）

rc.3 两项 Rust 基准已完成实测；全部本地门禁已通过，源码基线 CI 已通过。各结果按所测版本、执行范围与日志分别记录，基准通过数量不代表 Rust 常规测试或完整测试套件数量。

| 门禁 | 命令或验收范围 | rc.3 结果 |
| --- | --- | --- |
| 前端依赖 | `pnpm install --frozen-lockfile` | 通过 |
| 前端静态检查 | `pnpm typecheck` / `pnpm lint` | 通过 |
| 前端测试 | `pnpm test` | 通过：34 文件 / 221 项全部通过；20:19:20 开始，25.20 秒 |
| 前端构建 | `pnpm build` | 通过：Tauri beforeBuild 执行 tsc + Vite，18.03 秒 |
| 前端审计 | `pnpm audit` | 通过：No known vulnerabilities found |
| Rust 检查 | `cargo check --manifest-path src-tauri/Cargo.toml --locked` | 通过 |
| Rust 格式 | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | 通过 |
| Rust Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` | 通过 |
| Rust 常规测试 | `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 通过：74 passed / 2 ignored，6.78 秒；两项 ignored 基准已单独通过 |
| Rust 审计 | 在 `src-tauri` 下执行 `cargo audit --file Cargo.lock` | 通过：exit 0；17 条 allowed warnings，与 rc.2 相同 |
| 大型正文 benchmark | 1000 章 / 1,000,000 字 | 通过：42.180 秒；数据完整性断言通过，采样边界见下文 |
| V1.1 辅助数据 benchmark | 50 Story Arc / 500 Inbox / 100 Prompt Preset / 1000 Checklist | 通过：22.605 秒；数据完整性断言通过，采样边界见下文 |
| Windows 构建 | `pnpm tauri build` | 通过：EXE/NSIS ProductVersion 均为 1.1.0-rc.3；大小及 SHA-256 见 TEST_REPORT |
| 桌面 CDP | `WEBDRIVER=0` / `NATIVE=0` | 完整通过；含 WIKI_MENTION_COUNT_OK 和原六项标记；日志见本文记录 |
| 桌面 WebDriver | `WEBDRIVER=1` / `NATIVE=0` | 完整通过；含 WIKI_MENTION_COUNT_OK 与原六项标记；日志见本文记录 |
| 桌面 WebDriver + Native Dialog | 原生对话框模式 | 完整通过，exit 0；含 WIKI_MENTION_COUNT_OK、原六项与 NATIVE_DIALOGS_OK；日志见本文记录 |
| CI | `0f1eb3f8756a5936491f483c783387598b01a3d7`；[run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) | completed / success；Frontend checks 与 Rust checks 均 completed / success |
| 分支保护 | main protection / rulesets / Required Checks | 已生效：Frontend checks / Rust checks；strict 与管理员约束开启；不强制 PR，禁止强推及删除，完整字段见本文记录 |
| 发布 | rc.3 tag、Release 与资产 | 未发布 |

### rc.3 Rust 基准实测与内存采样

- `LARGE_PROJECT_BENCHMARK_MS=42180`；`V1.1_AUXILIARY_BENCHMARK_MS=22605`。
- 测试结果：`2 passed; 0 failed; 0 ignored`。执行耗时 65.20 秒，编译耗时 43.11 秒单独记录，不计入该执行耗时。
- 采样间隔 250 ms，共 248 次；合并两项测试进程的 `sampledPeakWorkingSetBytes=31264768`（约 29.8 MiB），`sampledPeakPrivateBytes=9777152`（约 9.32 MiB）。这些是采样观测峰值，不是绝对内存上限，且不包含编译进程。
- 无 panic、OOM 或异常超时；数据完整性断言全部通过。
- 相较 rc.1 的 36.48 / 18.71 秒，约 +15.6% / +20.8%，均未超过约 30% 的分析阈值。本次含采样开销且主机负载存在差异；rc.2 基准版本至 rc.3 只有版本变化、无 Rust 业务改动，不据此严格归因为代码回退。
- 日志：`src-tauri/target/rc3-benchmark.*.log`，位于被忽略的本地构建目录，不随仓库文档分发。rc.2 补验结果保留为历史对照，不替代上述 rc.3 实测。
- 本项结果仅覆盖两项显式运行的 ignored benchmark；Rust 常规测试、完整门禁与发布状态仍按上表分别验证。

### 定向回归验收（自动化与三种桌面模式均通过）

- **ISSUE-01（Wiki 统计）**：区分识别建议与统计语义。Mention Inspector 不重复提示已有 Wiki；统计应计入已知人物、地点和世界观的 Wiki mention。普通文本与 Wiki 混合时精确累计，未知 Wiki 不生成已知资料计数，代码区 Wiki 仍排除。修复已完成，全部新增回归已纳入 rc.3 前端 34 文件 / 221 项测试并通过；三种桌面 E2E 均已完整通过。
- **ISSUE-02（Markdown 边界）**：统一 Markdown protected-range 处理；fence opener 长度至少 3，closer 字符相同且长度不小于 opener，多 backtick inline code 按相同 delimiter 长度闭合，未闭合 fence 保护到文末。保留 URL、链接/图片目标、Wiki 和 frontmatter 边界，核对与 Markdown 字符转换 helper 的一致性。修复已完成，全部新增回归已纳入 rc.3 前端 34 文件 / 221 项测试并通过；三种桌面 E2E 均已完整通过。
- ISSUE-01 场景：普通人物文本、Wiki 人物、混合重复、Wiki 地点、Wiki 世界观、未知 Wiki、代码块内 Wiki；人物统计断言精确 count，并核对共同出现与章节矩阵。
- ISSUE-02 场景：普通/长 backtick fence、tilde fence、短 closer、不同字符 closer、多 backtick inline code、未闭合 fence；人物/地点/世界观均不得从代码区泄漏。
- 桌面保留 `MENTION_DETECTION_OK`、`STORY_ARC_OK`、`CHARACTER_STATS_OK`、`PROMPT_PRESET_OK`、`INBOX_OK`、`CHAPTER_CHECKLIST_OK` 六项标记及既有阶段；`WIKI_MENTION_COUNT_OK` 精确计数断言与上述标记均已在 CDP 完整回归中通过；WebDriver 第二轮完整通过，Native Dialog 完整通过（exit 0）。

## V1.1.0-rc.2 历史基线

依据既有 [rc.2 发布说明](docs/releases/v1.1.0-rc.2.md)：前端 33 文件 / 188 项、Rust 74 项常规测试通过；两项大型 benchmark 在 rc.2 发布轮次未重跑，后续基线补验已通过（详见 TEST_REPORT）。这些结果仅适用于对应历史版本。既有安装包为 `NovelForge_1.1.0-rc.2_x64-setup.exe`；不将后续源码修复归入该安装包。

> 以下为历史验收记录，其中“当前”“最新”仅指当时的版本与轮次。

## 当前轮次

> 本节为早期结果，已被后续最终验收取代。历史命令、环境和未覆盖项保留用于追溯，当前候选状态见文首 rc.3 当前验收记录。

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
- 请在 Windows + WebView2 桌面上按 `DESKTOP_E2E_CHECKLIST.md`（历史文件名，当前工作区未找到） 完成创建项目、编辑保存、资料 CRUD、导出、回收站恢复、AI 本地模式和异常恢复的人工验收。
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

## P1-05 结构化一致性规则验证（2026-08-30）

- 新增人物年龄/生日/性别冲突、死亡后时间线出现、人物/地点疑似相似名称、时间线日期逆序和结束早于开始规则。
- 规则只读取资料和时间线等结构化字段；死亡后出现不会扫描普通正文内容来强行判定。
- 每条新增问题沿用 severity、code、title、detail、refId、refKind、path 字段，并可由一致性页面定位到资料或时间线实体。
- 前端回归：12 个测试文件 / 58 项测试全部通过；覆盖全部新增规则。
- Rust 回归：31 项常规测试通过，1 项大型基准按设计忽略；覆盖真实命令链和前后端语义对齐。

## P1-06 结构化导出与格式保真验证（2026-08-30）

- Markdown 先解析为统一 ExportDocument AST，再渲染 TXT、HTML、DOCX、EPUB 和 PDF；不再按格式各自逐行转普通文本。
- 回归覆盖 H1-H6、行内粗体/斜体/删除线/代码、引用、无序/有序/任务列表、链接、Wiki、分割线、代码块和表格。
- TXT 清理 Markdown/Wiki 标记；HTML 使用语义标签和 data URI 封面；DOCX 检查 Heading、Bold、Italic、List、Table、编号和嵌入图片；EPUB 检查 OPF 元数据、nav 分章和封面资源。
- PDF 使用结构化纯文本分页，保持中文 CID 字体、标题文本和无 Markdown 标记；JPEG 封面生成 PDF 图片对象，其他格式仍保留封面资源校验。
- Rust 导出回归：32 项常规测试通过，1 项大型基准按设计忽略；新增 AST 多格式/封面端到端测试通过。

## P1 全量质量门禁与发布复核（2026-08-30）

| 层级 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| Frontend type/lint/test/build | pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run、pnpm.cmd build | 全部通过；12 个测试文件 / 58 项测试，最大 chunk 约 364 kB |
| Rust compile/tests | cargo check、cargo test --manifest-path src-tauri/Cargo.toml | 通过：32 项常规测试，1 项大型基准 ignored |
| Large benchmark | cargo test --manifest-path src-tauri/Cargo.toml large_project_acceptance_handles_1000_chapters_and_one_million_characters -- --ignored --nocapture | 通过：1,000 章、1,000,000 字，53.14 秒 |
| Windows release | pnpm.cmd tauri:build | 通过：src-tauri/target/release/novelforge.exe 与 NSIS 安装包 |
| Release smoke | 独立启动 release EXE 4 秒 | 通过：进程保持运行且 Responding=True，检查后正常退出 |

已复核 TODO、PROGRESS、TEST_REPORT 和 DESKTOP_E2E_CHECKLIST；真实桌面鼠标级 WebView2 E2E 仍需人工按清单执行，未将进程级冒烟冒充鼠标级验收。

## P2-01 AI 上下文增强验证（2026-08-30）

- CodeMirror 选区同步到 AppState，当前选区和当前段落均可作为独立上下文项。
- 最近 1/3/5/10 章按真实卷/章节顺序选择；手动正文节点和人物、地点、世界观、笔记资料继续可选。
- 上下文预算显示字符数和预计 Token，超过 80,000 字符会在发送前明确阻止并提示。
- 选区任务结果支持复制、Esc 取消、替换选区、插入选区后，不提供隐式整章覆盖。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run：通过，12 个测试文件 / 61 项测试。

## P2-02 命令与存储模块化验证（2026-08-31）

- commands/mod.rs 保留兼容入口；AI、搜索、统计实现分别迁移到 commands/ai.rs、commands/search.rs、commands/statistics.rs。
- 项目、正文、资料、恢复、回收站、一致性、导出和 storage/database、filesystem、migration 领域边界已建立，后续可继续逐模块迁移而不改变 Tauri 注册接口。
- cargo check：通过；cargo test：32 项常规测试通过，1 项大型基准按设计 ignored。

## P2-03 GitHub Actions CI 验证（2026-08-31）

- 已检查 .github/workflows/ci.yml 的触发器、权限、pnpm 版本、锁文件安装和 Rust 工作目录。
- CI 在 main push / pull_request 上执行 pnpm install --frozen-lockfile、pnpm typecheck、pnpm lint、pnpm test、pnpm build、cargo check 和 cargo test。
- GitHub 云端运行结果需在首次 push/PR 后由远程 Actions 提供；本地等价命令已在本轮各阶段通过。

## P2-04 单章大文件验收（2026-08-31）

- 新增真实命令链：生成超过 100,000 个中文字符的单章，打开、插入、删除、搜索、保存、重开并核对最终正文。
- cargo test --manifest-path src-tauri/Cargo.toml single_chapter_100k_chinese_acceptance_covers_edit_search_and_reopen -- --nocapture：通过，1 passed，约 0.13 秒。
- WebView2/CodeMirror 的 FPS、滚动和输入体感属于桌面人工验收，已补入 DESKTOP_E2E_CHECKLIST.md；未将命令层耗时冒充 UI 帧率结论。

## P3-01 插件 API 与内部 Registry 验证（2026-08-31）

- PluginRegistry 测试覆盖两个内置插件、六类扩展点、唯一 ID 冲突和注册失败原子性。
- 前端门禁：pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；13 个测试文件 / 63 项测试。
- API 文档明确 V1.0 只允许源码显式注册，不加载或执行任意外部 JavaScript；V1.x 加载器需另行完成 manifest、权限和沙箱设计。

## P3-02 桌面 E2E release 预检（2026-08-31）

- pnpm.cmd tauri:build：通过；重新生成 release EXE 和 NSIS 安装包。
- 独立启动 src-tauri/target/release/novelforge.exe 4 秒：通过，进程 Responding=True，检查后正常退出。
- tauri-driver、msedgedriver 未安装；真实 Windows WebView2 鼠标级工作流、CodeMirror FPS 和六种导出文件的阅读器确认仍需人工按清单完成。

## V1.0 RC 自动门禁复核（2026-08-31）

| 层级 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| Frontend | pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run、pnpm.cmd build | 通过；13 个测试文件 / 63 项测试 |
| Rust | cargo check、cargo test --manifest-path src-tauri/Cargo.toml | 通过；33 项常规测试，1 项 ignored |
| Large acceptance | 1000 章 / 1,000,000 字 ignored 基准 | 通过；54.60 秒 |
| Release | pnpm.cmd tauri:build + 独立 EXE 4 秒启动 | 通过；EXE Responding=True，NSIS 已生成 |

人工门禁仍未宣称完成：需要在带 WebView2 的 Windows 桌面按 DESKTOP_E2E_CHECKLIST.md 操作并记录 FPS、导出文件阅读结果。

## P3-02 CDP 桌面自动化验证（2026-08-31）

- 命令：pnpm.cmd test:e2e:desktop。
- 结果：通过；脚本启动隔离用户目录中的 release EXE，并通过 WebView2 CDP 完成核心编辑器/正文树、资料 CRUD、规划视图、搜索、AI 选区/最近章节/Esc 取消、回收站恢复和六种导出生成。
- 阶段标记：CORE_EDITOR_TREE_OK、HISTORY_AND_TREE_ACTIONS_OK、ENTITY_CRUD_OK、PLANNING_AND_CHECKS_OK、SEARCH_OK、AI_SELECTION_AND_CANCEL_OK、AI_PROVIDER_OK、TRASH_RESTORE_OK、EXPORTS_OK。
- 导出自动断言：Markdown 保留中文/粗体，TXT 清理 Markdown/Wiki 标记，HTML 保留 strong 语义，PDF 头正确，DOCX/EPUB 文件非空。
- 初版 CDP 运行当时仍需人工：CodeMirror FPS/滚动体感及用实际安装的 Word/WPS、LibreOffice/Calibre、Sumatra/Acrobat 等阅读器打开并核对六种导出文件；最终 WebDriver/原生对话框结果见下节。

## P3-02 官方 WebDriver 与原生对话框验证（2026-08-31）

> 本节记录 2026-08-31 旧候选的成功复跑；2026-09-03 当前候选的原生附件选择器状态以文末 RC 验收记录为准。

- 命令：设置 EDGE_DRIVER_PATH 指向与 WebView2 151 匹配的官方 msedgedriver.exe，并设置 NOVELFORGE_E2E_WEBDRIVER=1、NOVELFORGE_E2E_NATIVE_DIALOGS=1 后运行 pnpm.cmd test:e2e:desktop。
- 结果：通过；tauri-driver 2.0.6 + Microsoft Edge WebDriver 151.0.4129.107 建立 WebView2 会话，原生文件夹/文件选择器由 Windows UI Automation 完成，确认/提示框由 WebDriver 对话框事件处理。
- 新增回归：真实应用重启后的保存失败与恢复提示、恢复内容预览/写回/清理、拖拽和批量恢复、Wiki 跳转、设置/命令面板、原生附件导入。
- 两种模式均通过的阶段标记：CORE_EDITOR_TREE_OK、DRAG_DROP_OK、HISTORY_AND_TREE_ACTIONS_OK、ENTITY_CRUD_OK、WIKI_NAVIGATION_OK、SETTINGS_COMMANDS_OK、RECOVERY_FAILURE_OK、NATIVE_DIALOGS_OK、PLANNING_AND_CHECKS_OK、SEARCH_OK、AI_SELECTION_AND_CANCEL_OK、AI_PROVIDER_OK、TRASH_RESTORE_OK、EXPORTS_OK。
- 导出结构断言继续通过：Markdown 保留中文/粗体，TXT 清理 Markdown/Wiki，HTML 保留 strong，PDF 头正确，DOCX/EPUB 文件非空。阅读器视觉确认和 CodeMirror FPS 仍未虚报完成。

## 最终全量门禁重跑（2026-08-31）

- 代码提交 83fe730 后，前端 typecheck、lint、test -- --run、build 全部通过（13 个测试文件 / 63 项测试）。
- Rust cargo check、cargo test 全部通过（33 项常规测试）；1000 章 / 100 万字 ignored 基准通过，耗时 52.72 秒。
- pnpm.cmd tauri:build 通过并重新生成 release EXE/NSIS；独立进程启动 4 秒保持 Responding=True 后精确关闭。
- 直连 CDP 和官方 WebDriver + 原生 UI Automation 两种 E2E 模式均通过全部阶段标记；剩余人工门禁为 CodeMirror FPS/滚动体感和 Markdown/TXT/HTML/DOCX/EPUB 五种导出物的逐页视觉确认，PDF 已在 Edge/SumatraPDF 中完成视觉复核。

## 外部阅读器冒烟补充（2026-08-31）

- Markdown/TXT 已由 Windows 记事本打开并通过 UI Automation 读取中文正文；HTML/PDF 已由独立 Edge 窗口打开。
- DOCX 已由 LibreOffice Portable Writer 26.2.4 以只读窗口打开，且 soffice --convert-to pdf 返回 0；EPUB 已由 Calibre Portable eBook Viewer 9.14.0 打开并读取目录；SumatraPDF 3.6.1 已安装。
- 这些是外部阅读器加载冒烟和文本/转换证据；PDF 的中文、封面和页面布局已另行完成 Edge/SumatraPDF 视觉复核，其余五种格式仍保持逐页人工签核状态。

## 大文档 WebView2 FPS 采样（2026-08-31）

- 新增可选环境变量 NOVELFORGE_E2E_FPS=1；性能阶段在真实 release WebView2 中分块注入超过 100,000 个中文字符，确认 editor-pane overflow 容器后滚动采样 2 秒 rAF，并恢复基线正文。
- 直连模式：286 帧，约 142.8 FPS；内容约 57,030 px，视口 670 px；替换 655 ms，保存 260 ms。
- 官方 WebDriver + 原生对话框模式：278 帧，约 139.0 FPS；内容约 58,140 px，视口 670 px；替换 715 ms，保存 292 ms。
- 该结果是量化补充，不替代滚动/输入主观体感与六种导出文件逐页视觉签核。

## 带测试封面导出夹具与阅读器复核（2026-08-31）

- commit 0710bbd 增加 NOVELFORGE_E2E_COVER=1 和 NOVELFORGE_E2E_KEEP_PROJECT=1；直连 release E2E 通过全部阶段标记，FPS 为 286 帧、约 142.9 FPS，并保留项目 C:\Users\Jiang\AppData\Local\Temp\novelforge-desktop-e2e-project-30116。
- 六种导出均生成；HTML 在独立 Edge 中加载并通过 UI Automation 读取标题、目录和中文正文；Markdown/TXT 在记事本中读取；DOCX 在 LibreOffice Portable Writer 中打开；EPUB 在 Calibre Portable 中打开并显示目录；PDF 在 Edge 与 SumatraPDF 中均显示 1 页加载状态。
- 7-Zip 归档检查确认 DOCX 的 word/media/cover.png 与 EPUB 的 OEBPS/images/cover.png 存在。该结果是封面资源与阅读器加载证据，不替代五种非 PDF 格式的逐页视觉签核；PDF 视觉核对见下一节。

## PDF 中文字体嵌入与跨阅读器视觉复核（2026-08-31）

- commit e9ed8f3 将 Windows 系统中文字体（优先 C:\Windows\Fonts\simhei.ttf，可由 NOVELFORGE_PDF_FONT 覆盖）通过 printpdf 子集嵌入 PDF；无可用 CJK 字体时保留旧实现回退。
- 最新 release 重新生成的 PDF 为 C:\Users\Jiang\AppData\Local\Temp\novelforge-desktop-e2e-project-33364\.novelforge\exports\CDP桌面验收-20260830220250089.pdf，大小约 5.1 MB，Poppler pdftotext/pdftohtml -xml 可读中文并识别封面图像。
- Edge 与 SumatraPDF 3.6.1 实际窗口均显示 1 页；标题、作者、卷章标题、中文正文和测试封面均清晰，无此前 STSong-Light 未嵌入导致的乱码。
- 因此 PDF 的跨阅读器视觉问题已关闭；剩余仍是 Markdown/TXT/HTML/DOCX/EPUB 的逐页视觉签核，以及 CodeMirror 100,000 字单章滚动/输入主观体感。

## PDF 修复后官方 WebDriver 重跑与五种导出视觉复核（2026-08-31）

- 使用同一 release 重新运行 EDGE_DRIVER_PATH + NOVELFORGE_E2E_WEBDRIVER=1 + NOVELFORGE_E2E_NATIVE_DIALOGS=1 + NOVELFORGE_E2E_FPS=1；全部阶段标记（含 NATIVE_DIALOGS_OK、RECOVERY_FAILURE_OK、EXPORTS_OK）通过。
- 本轮 100,000 字 editor-pane 采样 276 帧、约 137.7 FPS，内容 57,030 px、视口 670 px，替换 824 ms、保存 289 ms；量化结果仍不替代主观滚动/输入体感。
- 同一保留项目目录的只读窗口截图：记事本 Markdown/TXT 中文、目录和章节可读；Edge HTML 标题、作者、封面和目录可读；LibreOffice Writer DOCX 封面、标题、列表和正文可读；Calibre EPUB 目录和中文目录可读。DOCX 另经 LibreOffice 转 PDF 渲染两页，正文/列表/封面均可读。
- Calibre 当前目录链接未完成正文跳转，故不把 EPUB 全部正文视觉签核或五种格式总体门禁标为完成；剩余项目仍为 EPUB 正文页确认、Markdown/TXT/HTML/DOCX 的逐页细节复核以及 CodeMirror 主观体感。

## P3-02 最终人工门禁（2026-08-31）

- release WebView2 大文档验收：100,000 字以上中文单章完成插入、删除、搜索、保存、关闭/重开和滚动/输入观察；官方 WebDriver 修复后采样 276 帧、约 137.7 FPS，替换 824 ms、保存 289 ms。
- Markdown/TXT：Windows 记事本打开并核对标题、作者、目录、卷章顺序和正文；TXT 已清理 Markdown/Wiki 标记。
- HTML：Edge 独立窗口打开单文件 HTML，标题、作者、测试封面、目录、标题层级、列表和正文可读。
- DOCX：LibreOffice Writer 只读打开，封面、标题、列表和正文可读；转换为 PDF 后两页版式可读。
- EPUB：Calibre Portable 9.14.0 打开目录和正文；真实双击目录“第二卷”后跳转到显示“第二卷 / 第二章 副本 / 序章”的正文页，第一卷页显示“林月 来到雾港。”及列表。
- PDF：Edge、SumatraPDF 3.6.1 和 Poppler 均确认嵌入中文字体版本的标题、正文、章节和封面。
- 结论：桌面 E2E 清单所有项目已完成本机验收；剩余仅为不同硬件/阅读器组合的可选兼容性抽查。工作区中唯一未跟踪文件是用户提供的收尾计划，不属于实现改动。

## 官方 WebDriver 稳定性复跑（2026-08-31）

- 使用 EdgeDriver 151.0.4129.107（与 WebView2 151.0.4129.107 匹配）运行官方 Tauri WebDriver + Windows UI Automation；修复选择器控件筛选、路径输入回退、目录刷新和文件名输入框后，全部桌面阶段标记通过。
- 性能结果：100,000 字 editor-pane 采样 276 帧、约 137.75 FPS，替换 726 ms、保存 290 ms；原生文件夹/文件选择器、附件导入、保存失败恢复重启均通过。
- 失败复跑产生的临时项目目录已删除；用户提供的收尾计划保持未跟踪，不计入实现提交。

## GitHub Actions Ubuntu CI 闭环（2026-09-01）

| 层级 | GitHub Actions run 33529012970 | 结果 |
| --- | --- | --- |
| Frontend | pnpm install、typecheck、lint、test、build | success |
| Linux prerequisites | Tauri 2 Debian WebKitGTK/GTK 依赖安装 | success |
| Rust compile | Ubuntu cargo check | success |
| Rust tests | Ubuntu cargo test | success |
| Check annotations | Frontend checks、Rust checks | 0 annotations |

- 失败基线为 run 33387176701：Frontend checks 通过，Rust cargo check 退出 101，cargo test 被跳过。
- commit ed5d0cc 增加 Linux 系统依赖并升级 Node 24 action runtime；修复后的两个 job 均为 success，P2-03 远程门禁关闭。

## 全局右键菜单回归（2026-09-02，早期记录）

> 本节为第一次菜单回归记录；汇总结果和当前候选状态见后文，历史证据保留用于追溯。

| 层级 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| Frontend type | pnpm.cmd typecheck | 通过 |
| Frontend lint | pnpm.cmd lint | 通过，0 error / 0 warning |
| Frontend tests | pnpm.cmd test -- --run | 通过：16 个测试文件 / 70 项测试 |
| Context menu unit | 几何避让、分隔线清理、子菜单翻转 | 通过 |
| Clipboard unit | 受控输入替换/删除、失败不破坏内容 | 通过 |
| Plugin unit | 旧接口、插槽筛选、排序、异常禁用 | 通过 |
| React interaction | Provider 右键打开、菜单操作、关闭 | 通过 |

### 桌面验收结果

- release WebView2 CDP E2E 已覆盖编辑器和章节树右键、四角避让、Escape 关闭及完整既有流程，所有阶段标记通过。
- 本轮未重复官方 WebDriver/native dialog 流程；原生确认框、剪贴板权限和逐项视觉检查仍可按 DESKTOP_E2E_CHECKLIST.md 进行补充抽查。

## 全局右键菜单回归（2026-09-02，汇总记录）

| 层级 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| Frontend type | pnpm.cmd typecheck | 通过 |
| Frontend lint | pnpm.cmd lint | 通过，0 error / 0 warning |
| Frontend tests | pnpm.cmd test -- --run | 通过：16 个测试文件 / 70 项测试 |
| Context menu unit | 几何避让、分隔线清理、子菜单翻转 | 通过 |
| Clipboard unit | 受控输入替换/删除、失败不破坏内容 | 通过 |
| Plugin unit | 旧接口、插槽筛选、排序、异常禁用 | 通过 |
| React interaction | Provider 右键打开、菜单操作、关闭 | 通过 |

### 尚需桌面验收

> 本节为早期 rc.1 结果，已被后续最终验收取代；当前 rc.2 结果见文档末尾的 Final Validation。

## V1.0.0-rc.1 当前候选验收（2026-09-03）

### 已完成

- `pnpm.cmd install --frozen-lockfile`：通过，锁文件与依赖一致。
- `pnpm.cmd typecheck`、`pnpm.cmd lint`、`pnpm.cmd test -- --run`、`pnpm.cmd build`：全部通过；16 个测试文件 / 72 个测试。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过；commands 与 storage 已按领域真实拆分，源码无 `include!` 临时拼接。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过；35 个常规测试通过，1 个大型基准按设计 ignored。
- `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture`：通过；1000 章、100 万字大型基准 58.76 秒。
- `pnpm.cmd tauri:build`：通过；生成 `src-tauri/target/release/novelforge.exe` 和 `NovelForge_1.0.0-rc.1_x64-setup.exe`。
- 直连 release WebView2 CDP：通过；`CONTEXT_MENU_OK`、`PLANNING_CONTEXT_MENU_OK`、`EXPORTS_OK` 及全部既有阶段标记均出现；新增右键粗体、规划区菜单、插件扩展项和点击外部关闭断言通过。插件排序/异常启用条件另由 `tests/plugin-registry.test.ts` 覆盖。
- 官方 Tauri WebDriver WebView2（不启用原生文件对话框）：通过；当前 release 的全部旧阶段及 `CONTEXT_MENU_OK`、`PLANNING_CONTEXT_MENU_OK`、`EXPORTS_OK` 均出现。

### 当前限制

- 官方 Tauri WebDriver + 原生 UI Automation 已使用匹配驱动尝试复跑；项目创建、恢复重启等阶段可通过，但原生附件选择器存在系统列表刷新/焦点竞态，当前候选未将该次失败伪装为通过。直连 CDP 结果不受影响；可在稳定桌面焦点环境重试。
- 发布候选代码提交 `40ae175` 已推送到 GitHub `main`；run `33699593424` 的 Frontend checks 与 Rust checks 均为 success；随后发布记录提交 `1751dfd` 的 run `33705658724` 也均为 success。`v1.0.0-rc.1` 已创建并指向 `40ae175`；历史 run `33529012970` 仍不作为本次发布候选证据。

## V1.0.0-rc.2 Final Validation（2026-09-03）

### FIX-01 脚注预览

- `MarkdownPreview` 使用 ReactMarkdown + remark-gfm，并配置中文 `footnoteLabel` / `footnoteBackLabel`。
- 组件级 `tests/editor-footnote.test.tsx` 已验证编号脚注、命名脚注、重复引用、中文内容、引用/返回锚点以及 inline/fenced code 排除。
- Rust/HTML/EPUB/DOCX/PDF/TXT 导出回归继续通过，现有脚注内容与锚点行为未退化。

### FIX-02 全角 / 半角

- `convertFullwidth` / `convertHalfwidth` 覆盖 U+0021–U+007E 与 U+FF01–U+FF5E，支持显式空格转换选项并保持可逆。
- 测试覆盖 ASCII 标点、字母数字、Markdown 粗体/斜体/标题/列表、inline/fenced code、URL、Markdown link/image、Wiki Link、脚注、frontmatter、中文和中英混合内容。
- UI、README、SPEC、CHANGELOG、TODO、PROGRESS、DECISIONS 与本报告均采用“完整 ASCII 可见字符”定义；中文标点转换仍为独立功能。

### FIX-03 桌面 E2E

- rc.2 release CDP：`CONTEXT_MENU_OK`、`CORE_EDITOR_TREE_OK`、`DRAG_DROP_OK`、`HISTORY_AND_TREE_ACTIONS_OK`、`ENTITY_CRUD_OK`、`WIKI_NAVIGATION_OK`、`SETTINGS_COMMANDS_OK`、`RECOVERY_FAILURE_OK`、`PLANNING_AND_CHECKS_OK`、`PLANNING_CONTEXT_MENU_OK`、`SEARCH_OK`、`AI_SELECTION_AND_CANCEL_OK`、`AI_PROVIDER_OK`、`TRASH_RESTORE_OK`、`EXPORTS_OK` 全部通过。
- rc.2 官方 Tauri WebDriver + Native Dialog：同一批阶段标记全部通过，并真实完成项目文件夹选择、恢复重启和附件导入，输出 `NATIVE_DIALOGS_OK`。
- 自动化增强包含地址栏导航、UIA ValuePattern 优先、刷新期间控件重解析、条件等待和最多三次有限重试；不依赖文件列表固定索引，也不允许无限重试。

### 本地门禁与发布状态

- `pnpm.cmd install --frozen-lockfile`、typecheck、lint、`pnpm.cmd test -- --run`（17 文件 / 75 项）、build、cargo check、cargo test、ignored 大型基准（50.90 秒）和 `pnpm.cmd tauri:build` 全部通过。
- rc.2 代码提交 `961ad26`，release 产物为 `src-tauri/target/release/novelforge.exe` 与 `NovelForge_1.0.0-rc.2_x64-setup.exe`；旧 `v1.0.0-rc.1` tag 未移动。
- rc.2 远程 tag 已验证：`v1.0.0-rc.2` 指向 `961ad26`，`main` 指向 `5aac219`；GitHub Actions run #11（`33712235453`）Frontend/Rust 均 success。
- GitHub [Pre-release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.0.0-rc.2) 已发布，NSIS 资产 `NovelForge_1.0.0-rc.2_x64-setup.exe` 状态为 uploaded，大小 5,127,968 bytes，SHA-256 为 `C760969ECC72DEA0A7B6FFC5026C49B72597C68972FA41AAC9697412FA2ABD1A`；`main` Required Checks 仍是管理员待办。
# V1.1 P1 自动资料识别验证（2026-09-05）

| 层级 | 验证 | 结果 |
| --- | --- | --- |
| Mention 单元测试 | 中文/英文、别名、重叠、Markdown 排除、永久忽略、删除/重命名重扫、Wiki 插入 | 9 项通过 |
| 前端回归 | `pnpm typecheck`、`pnpm lint`、`pnpm test` | 通过；22 文件 / 121 项 |
| Rust 恢复 | `mention-ignore` Markdown 镜像在数据库删除后重建 | 通过 |
| Rust 回归 | `cargo check --locked`、`cargo test --locked` | 通过；43 项常规测试，1 项 ignored |

P1 扫描结果和出现索引均可重新计算；测试没有把缓存存在当成恢复证据。桌面交互将在 V1.1 最终 E2E 脚本中与 P2–P6 一并执行。
# V1.1 P2 剧情线验证（2026-09-05）

| 层级 | 验证 | 结果 |
| --- | --- | --- |
| Story Arc 单元测试 | 结构解析、状态、去重、milestone 排序、健康/异常引用 | 6 项通过 |
| 浏览器集成 | 创建、编辑、多个剧情线、章节关联、删除、回收站恢复 | 通过 |
| Rust 集成 | 四类 issue code、Markdown 镜像和数据库重建 | 通过 |
| 前端回归 | `pnpm typecheck`、`pnpm lint`、`pnpm test` | 通过；23 文件 / 128 项 |
| Rust 回归 | `cargo check --locked`、`cargo test --locked` | 通过；44 项常规测试，1 项 ignored |
# V1.1 P3 人物出场统计验证（2026-09-05）

| 层级 | 验证 | 结果 |
| --- | --- | --- |
| 统计单元测试 | 小节归并、首次/最近、提及计数、共同人物、主要地点 | 通过 |
| 缓存与读取 | 45 个文档分批加载、缓存复用、强制重扫 | 通过 |
| 大矩阵窗口 | 1000 章、100 人物仅返回当前分页窗口 | 通过 |
| 前端回归 | `pnpm typecheck`、`pnpm lint`、`pnpm test` | 通过；24 文件 / 131 项 |
| Rust 回归 | `cargo check --locked`、`cargo test --locked` | 通过；44 项常规测试，1 项 ignored |
# V1.1 P4 Prompt Preset 验证（2026-09-05）

| 层级 | 验证 | 结果 |
| --- | --- | --- |
| 变量单元测试 | 全部白名单变量、最近章节、实体上下文、未知/缺失变量阻断 | 通过 |
| 组件交互 | 运行前预览、字符/Token 展示、本地执行、缺少选区不执行 rewrite | 通过 |
| 浏览器集成 | 模板保存、删除和回收站恢复 | 通过 |
| Rust 恢复 | `prompts/` 镜像在数据库删除后恢复 ID、动作和模板 | 通过 |
| 前端回归 | `pnpm typecheck`、`pnpm lint`、`pnpm test` | 通过；26 文件 / 137 项 |
| Rust 回归 | `cargo check --locked`、`cargo test --locked` | 通过；45 项常规测试，1 项 ignored |
# V1.1 P5 灵感 Inbox 验证（2026-09-05）

| 层级 | 验证 | 结果 |
| --- | --- | --- |
| 数据单元测试 | 条目解析、处理目标、六类资料转换、剧情线 milestone 保留与追加 | 通过 |
| 组件交互 | 快速记录保存；目标创建失败时原灵感保持未处理 | 通过 |
| 快捷键 | 命令注册默认值 `Ctrl+Shift+I` | 通过 |
| Rust 恢复 | `inbox/` 镜像恢复原文、processed 和 processedInto | 通过 |
| 前端回归 | `pnpm typecheck`、`pnpm lint`、`pnpm test` | 通过；28 文件 / 147 项 |
| Rust 回归 | `cargo check --locked`、`cargo test --locked` | 通过；46 项常规测试，1 项 ignored |
# V1.1 P6 章节 Checklist 验证（2026-09-05）

| 层级 | 验证 | 结果 |
| --- | --- | --- |
| 数据单元测试 | 默认/自定义模板、独立状态、完成比例、三类树过滤、卷级 Dashboard | 通过 |
| Store 集成 | 新章节创建后复制项目模板 | 通过 |
| 浏览器集成 | 初始章节默认模板、新章节自定义模板、旧章节不覆盖 | 通过 |
| Rust 恢复 | 模板/实例独立目录恢复，Node.status 保持原值 | 通过 |
| 前端回归 | `pnpm typecheck`、`pnpm lint`、`pnpm test` | 通过；30 文件 / 153 项 |
| Rust 回归 | `cargo check --locked`、`cargo test --locked` | 通过；47 项常规测试，1 项 ignored |

# V1.1.0-rc.1 Final Validation（2026-09-05）

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；锁文件供应链策略通过 |
| `pnpm typecheck` / `pnpm lint` | 通过；0 warning |
| `pnpm test` | 通过；30 个测试文件、154 项测试 |
| `pnpm build` | 通过；Vite 6.4.3 生产构建 |
| `pnpm audit --audit-level high` | 通过；No known vulnerabilities |
| `cargo check --locked` | 通过 |
| `cargo test --locked` | 通过；47 passed、2 ignored |
| `cargo audit --file Cargo.lock` | 通过；0 个阻断性漏洞，17 条 allowed warnings |
| 1000 章 / 100 万字 | 通过；36.48 秒，真实 Markdown、SQLite、打开、统计和搜索 |
| V1.1 辅助数据 | 通过；50 Story Arc、500 Inbox、100 Prompt Preset、1000 Checklist，18.71 秒 |
| `pnpm tauri build` | 通过；release EXE 与 NSIS |

桌面 release 验收：

- 直连 CDP：全部旧阶段及 `MENTION_DETECTION_OK`、`STORY_ARC_OK`、`CHARACTER_STATS_OK`、`PROMPT_PRESET_OK`、`INBOX_OK`、`CHAPTER_CHECKLIST_OK`、`EXPORTS_OK` 通过。
- 官方 Tauri WebDriver：使用 `tauri-driver 2.0.6` 和匹配 WebView2 `152.0.4191.62` 的 Microsoft Edge WebDriver，全部标记通过。
- WebDriver + Native Dialog：真实选择新建/重开项目文件夹与附件文件，`RECOVERY_FAILURE_OK`、`NATIVE_DIALOGS_OK` 和全部其余标记通过。
- 失败保存测试在当前章节恢复文件写入后确定性阻断历史快照，重启后完成预览与恢复；状态栏不会在恢复文件尚未生成时误报。

发布产物：

- `novelforge.exe`：17,422,848 bytes；SHA-256 `94DCE86B4F3420C29F75F4FC5FB762BDAE98209B4E524134415519E1908563C2`。
- `NovelForge_1.1.0-rc.1_x64-setup.exe`：5,154,783 bytes；SHA-256 `E0E80D72E50E6484FEE1A9C9C0608291C4B83DAA3AEB7751A84064B871C11DB5`。
- 最新 `main` HEAD 的 GitHub Actions Frontend/Rust 检查成功；[v1.1.0-rc.1 Pre-release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.1) 附带上述 NSIS 资产。

## rc.3 最终验证证据与交付边界

源码基线 `0f1eb3f8756a5936491f483c783387598b01a3d7`（`fix/v1.1-audit-rc3`）已推送；[CI run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) 为 `completed / success`，Frontend checks 与 Rust checks 均为 `completed / success`。全分支 push 触发已由该 run 验证。

上述 CI 只证明该源码基线。后续文档提交仍须按受保护 main 规则重新运行并通过检查，再 fast-forward 更新 main；不将源码 CI 视为尚未产生的文档提交或 main 最终提交的验证结果。

### 历史基线与 tag 保留

`v1.1.0-rc.2` 未移动：远程与本地 tag 对象均为 `c4ac0ddd4c30a923ee9323de7ca1858c803817f5`，解引用仍为 `90a64257afd994eb3c541787c5350fb44d609494`。

rc.2 基线 `90a6425` 的 CI run `33947878811` 成功。rc.2 发布时未重跑大型 benchmark；后续补验通过，分别为 38.506 秒 / 20.076 秒（`38506` / `20076` ms），顺序单线程总耗时 58.96 秒，0 失败、0 忽略，无 panic/OOM 退出，未连续采样峰值内存。相较 rc.1 的 36.48 / 18.71 秒约 +5.55% / +7.30%。这些历史证据不替代 rc.3 实测，也不改写原发布说明。

### rc.3 本地门禁与基准

- 前端安装、typecheck、lint、审计通过；34 文件 / 221 项全部通过，20:19:20 开始，25.20 秒；pnpm audit 无已知漏洞。
- Rust check/fmt/Clippy `-D warnings` 通过；常规测试 74 passed / 2 ignored，6.78 秒；Cargo audit exit 0，17 条 allowed warnings，与 rc.2 相同。
- 两项 ignored benchmark 单独通过：`LARGE_PROJECT_BENCHMARK_MS=42180`、`V1.1_AUXILIARY_BENCHMARK_MS=22605`，即 42.180 / 22.605 秒；2 passed / 0 failed / 0 ignored，执行 65.20 秒，不含编译 43.11 秒。
- 每 250 ms 采样，共 248 次；合并两项测试进程 `sampledPeakWorkingSetBytes=31264768`（约 29.8 MiB）、`sampledPeakPrivateBytes=9777152`（约 9.32 MiB）。采样观测非绝对上限，不含编译进程；无 panic/OOM/异常超时，数据完整性断言通过。
- 相较 rc.1 约 +15.6% / +20.8%，均小于 30%；包含采样且主机负载不同，rc.2 基准版本至 rc.3 无 Rust 业务改动，不据此严格归因为代码回退。日志 `src-tauri/target/rc3-benchmark.*.log` 位于被忽略的本地构建目录。

### Windows 本地产物（未发布）

`pnpm tauri build` 成功；beforeBuild 执行 `pnpm build`（tsc + Vite），18.03 秒通过，计入前端 build 门禁。两项产物的 VersionInfo `ProductVersion` 均为 `1.1.0-rc.3`。

| 产物 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| `novelforge.exe` | 17507840 | `50047CAD09DC1F847316235F92F0129F13C4BB746DA6FE5E933AE8194DED833F` |
| `NovelForge_1.1.0-rc.3_x64-setup.exe` | 5167038 | `CF5B38C3AEE63E53F0791A1329CC75D072C623D43EB4D1E27D4E10228C70A92F` |

### 三种桌面 E2E

| 模式 | 结果 | 本地日志 |
| --- | --- | --- |
| CDP（WEBDRIVER=0 / NATIVE=0） | 完整通过 | `src-tauri/target/rc3-e2e-cdp.log` |
| WebDriver（WEBDRIVER=1 / NATIVE=0） | 完整通过 | `src-tauri/target/rc3-e2e-webdriver.log` |
| WebDriver + Native Dialog | 完整通过，exit 0 | `src-tauri/target/rc3-e2e-native.log` |

三轮均包含 `WIKI_MENTION_COUNT_OK`、`MENTION_DETECTION_OK`、`STORY_ARC_OK`、`CHARACTER_STATS_OK`、`PROMPT_PRESET_OK`、`INBOX_OK`、`CHAPTER_CHECKLIST_OK`；Native Dialog 额外通过 `NATIVE_DIALOGS_OK`。日志位于本地构建目录，不作为已发布资产。

### main 保护与维护流程

保护已生效：`required_status_checks.contexts=["Frontend checks", "Rust checks"]`、`strict=true`、`enforce_admins.enabled=true`、`required_pull_request_reviews=null`（不强制 PR）、`allow_force_pushes=false`、`allow_deletions=false`。全分支 push 已实际触发检查。

先推工作分支，等待待合入提交的必需检查成功，再 fast-forward 更新 main 或走 PR；提交变化后重新验证。文档提交同样适用，不预写最终提交哈希或 main 更新结果。

rc.3 候选源码完成、本地产物已验收，源码基线 CI 已通过。本次范围为修复与推送，不创建 rc.3 tag 或 Release，不上传发布资产；已发布安装包仍为 `NovelForge_1.1.0-rc.2_x64-setup.exe`。
