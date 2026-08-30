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

## 2026-08-30：V0.2 写作规划第六阶段

### 完成内容

- 新增 AI 辅助工作区：显式勾选正文 / 资料上下文，运行续写、润色、改写和摘要，并可预览、复制、追加或替换正文。
- 接入 OpenAI-compatible `/v1/chat/completions` 请求；Endpoint 和模型偏好可保存，API Key 只存在当前窗口内，不写入 localStorage、项目文件或日志。
- 未填写 Provider 地址或处于浏览器开发模式时提供本地离线草稿模式，核心写作不依赖账号或 API Key。
- 增加 Provider 地址校验、本地模拟 HTTP 响应解析、上下文提示和 API Key 不落盘测试。

### 验证结果

- `pnpm typecheck`：通过。
- `pnpm lint`：通过，0 error / 0 warning。
- `pnpm test`：通过，8 个测试文件、26 个测试。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，16 个 Rust 测试。

### 已知问题

- 仍需在用户实际 Provider / 本地模型上进行人工交互验收；本轮已用本地模拟 HTTP 服务验证请求响应链路。
- 桌面鼠标级 E2E 和 1000 章 / 100 万字性能验收仍待最终阶段。

### 下一步

- 完成大规模性能基准、桌面 E2E 和发布版最终审计。

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


## 2026-08-30：V0.2 最终验收阶段

### 完成内容

- 新增 1000 章 / 100 万字真实文件与 SQLite 验收基准，覆盖项目创建、1000 章正文写入、重新打开和统计读取。
- 修正基准的测试数据边界，确保首章也写入后再验证百万字统计。
- 完成 Windows x64 release EXE 和 NSIS 安装包构建，并启动实际 release EXE 做进程级冒烟。
- 增加桌面 E2E 人工验收清单，明确当前环境缺少 tauri-driver、geckodriver、chromedriver 和 Playwright，未虚报鼠标级自动化结果。

### 验证结果

- pnpm.cmd test：通过，9 个测试文件、28 个测试。
- pnpm.cmd typecheck：通过。
- pnpm.cmd lint：通过，0 error / 0 warning。
- pnpm.cmd build：通过，Vite 生产产物生成；保留主 bundle 超过 500 kB 的提示。
- cargo test --manifest-path src-tauri/Cargo.toml：通过，16 个测试；1 个大规模基准按设计标记为 ignored。
- cargo test --manifest-path src-tauri/Cargo.toml large_project_acceptance_handles_1000_chapters_and_one_million_characters -- --ignored --nocapture：通过，1 个测试，37.19 秒；1000 章、统计字数不少于 1,000,000。
- pnpm.cmd tauri:build：通过，生成 src-tauri/target/release/novelforge.exe 和 src-tauri/target/release/bundle/nsis/NovelForge_0.1.0_x64-setup.exe。
- Release smoke：通过，实际 release EXE 启动并被测试进程正常结束。

### 当前剩余

- 真实桌面鼠标级 E2E 仍需用户在 Windows + WebView2 桌面上按 DESKTOP_E2E_CHECKLIST.md 手动执行，或在后续环境安装桌面自动化驱动后执行。
- Rust 仍有 3 个非致命 dead-code 警告，Vite 仍提示主 bundle 超过 500 kB；两者不影响当前构建和运行。

### 下一步

- 完成桌面人工 E2E 后，回填清单中的结果并将最终验收项标记为完成。

## 2026-08-30：规格差距补齐与收尾

### 完成内容

* 正文树支持跨卷/跨章节移动、递归复制、拖拽排序和批量选择；移动时同步 Markdown 文件及子节点路径，数据库失败会回滚文件。
* 增加 Ctrl+P 快速打开、Ctrl+F 当前文档搜索、Ctrl+Shift+F 全项目搜索，并补齐全部资料类型筛选。
* 导出支持 Markdown、TXT、HTML、DOCX、EPUB、PDF；可选择整本、指定卷或指定章节，并配置作品名、作者、目录、卷/章节标题和封面路径。
* AI 支持续写、润色、改写、扩写、缩写、摘要、章节摘要、大纲、角色对话、设定建议和名字生成；Provider 增加名称、Temperature、Max Tokens。
* 补齐历史 Diff/复制旧版本、回收站清空、附件打开/章节关联、当前卷/章节统计和侧栏布局状态持久化。

### 验证结果

* pnpm.cmd test：通过，12 个测试文件、40 个测试。
* pnpm.cmd typecheck：通过。
* pnpm.cmd lint：通过，0 error / 0 warning。
* cargo test --manifest-path src-tauri/Cargo.toml：通过，17 个测试，1 个 ignored。
* pnpm.cmd tauri:build：通过，生成 Windows x64 release EXE 和 NSIS 安装包。
* Release smoke：通过，独立 release EXE 启动并在 3 秒后保持运行，测试后正常结束。

### 当前剩余

* 只剩真实桌面鼠标级 E2E 需要在带 WebView2 的 Windows 桌面人工执行；当前环境没有 tauri-driver / geckodriver / chromedriver / Playwright。
* Rust dead-code 警告和 Vite 主 bundle 体积提示属于非阻塞质量优化项，不影响功能完成或发布构建。

## 2026-08-30：规格差距二次补齐与最终发布验收

### 完成内容

- 资料字段扩展为人物/地点完整规格，并支持自定义字段、标签排序、地点树前序排序和循环父级约束。
- 写作规划补齐作品/卷/章节三级大纲、时间线标签、伏笔“部分回收”状态；资料条目显示正文 Wiki 反向引用章节。
- 正文树改为扁平化窗口渲染并保留折叠、拖拽、移动和批量选择。
- 保存后置数据库/索引写入改为事务；失败会恢复原正文并保留恢复文件。
- 损坏 SQLite 会被可逆隔离，程序从 manuscript 和资料 Markdown 镜像重建正文树、资料记录和搜索索引。
- 增加 DEBUG/INFO/WARN/ERROR 脱敏项目日志并在设置页查看；TXT 导出清理 Markdown 标记。

### 验证结果

- pnpm.cmd typecheck：通过。
- pnpm.cmd lint：通过，0 error / 0 warning。
- pnpm.cmd test -- --run：通过，12 个测试文件、40 个测试。
- cargo test --manifest-path src-tauri/Cargo.toml：通过，20 个测试，1 个大型基准 ignored。
- 大型最终验收：通过；10 卷、1000 章、100 万字、100 人物、100 地点、200 世界观、500 时间线、100 伏笔，事务化真实命令链 51.19 秒，并通过重新打开、统计和资料搜索。
- pnpm.cmd build：通过；主 bundle 约 1.20 MB，保留体积提示。
- pnpm.cmd tauri:build：通过；release EXE 15,187,968 bytes，NSIS 安装包 4,275,768 bytes。
- Release smoke：独立 EXE 启动 4 秒后仍存活，测试结束后按 PID 正常退出。

### 当前剩余

- 仅剩真实桌面鼠标级 E2E：需要用户在 Windows + WebView2 中按 DESKTOP_E2E_CHECKLIST.md 逐项点击确认；当前环境没有 tauri-driver 等驱动。
- PDF 标准 STSong-Light 字体的跨阅读器视觉一致性属于非阻塞质量优化。

## 2026-08-30：质量收尾

- 清理 Rust 非阻塞 dead-code 警告，提交 82fd0d6。
- 配置 React、CodeMirror、Markdown 和图标依赖的生产分包，最大 chunk 约 364 kB，构建体积警告消失。
- 质量阶段验证：cargo check 无代码警告，pnpm.cmd build 通过。
- 当前功能侧仍只剩带 WebView2 的 Windows 桌面鼠标级 E2E，需要用户手动执行。

## 2026-08-30：浏览器 fallback 对齐

- 修复 fallback 新建章/节路径，使其遵守 manuscript/volume_###/chapter_###/section_###.md 层级。
- 回收站改为保存递归节点、正文和资料快照，支持恢复、冲突保护、清空和永久删除。
- 浏览器模式选择 DOCX/EPUB/PDF 时明确提示使用桌面版，不再返回伪成功路径。
- 新增回归覆盖；前端测试从 40 项增至 41 项。
- 最新 release 独立启动与 WebView2 页面加载复核通过。

## 2026-08-30：正文读取安全收尾

- 修复正文文件读取失败时静默返回空字符串的问题，已删除或缺失正文现在返回可理解错误。
- 保存事务提交后的项目时间戳更新和恢复文件清理改为不影响已提交正文的安全后置操作，并记录 WARN 日志。
- 新增 Rust 回归测试；常规 Rust 测试为 23 passed、1 ignored。

## 2026-08-30：节点与资料事务收尾

- 创建卷/章/节时文件、数据库节点和 FTS 索引绑定同一事务，失败自动清理已创建路径。
- 重命名章节或小节时同步更新 Markdown 一级标题；数据库失败会恢复旧正文和旧索引。
- 资料 Markdown 镜像写入与 SQLite/FTS 同步提交，失败恢复旧镜像；禁止直接编辑回收站条目或跨类型修改资料。
- 新增对应回滚测试，常规 Rust 测试总数达到 23 项。

## 2026-08-30：fallback 输入边界收尾

- 浏览器 fallback 现在拒绝重复项目、空作品/节点/资料标题、无效节点状态和不存在的删除/恢复目标，与桌面版错误语义一致。
- 新增输入边界回归；前端测试总数达到 42 项。

## 2026-08-30：多卷章节引用与排序收尾

- 统一时间线、伏笔、附件、场景卡、大纲、导出选择和写作看板的章节顺序：先按卷顺序，再按卷内章节顺序。
- 章节引用解析和一致性检查现在接收完整正文树，避免多卷项目中卷内 orderIndex 重置导致章节跳转错位。
- 新增多卷前端排序/引用回归和 Rust 真实命令链一致性回归；当前前端测试 44 项，Rust 常规测试 24 项（另有 1 项大型基准按设计忽略）。

## 2026-08-30：fallback 指定章节导出收尾

- 浏览器 fallback 的指定章节导出现在递归包含所选章节及其小节，并从选中章节作为导出根节点生成 Markdown/TXT/HTML 内容。
- 对缺少章节 ID、缺少卷路径和不存在的导出目标返回与桌面版一致的明确错误。
- 新增正文内容导出回归；前端 44 项测试全部通过。

## 2026-08-30：fallback 正文编辑边界收尾

- 浏览器 fallback 的章节/小节重命名现在同步 Markdown 一级标题。
- 读取或保存卷节点会返回明确错误；正文内容类型无效时拒绝保存。
- 历史版本恢复现在保留恢复前快照、更新正文时间和写作统计，行为与桌面版一致。

## 2026-08-30：fallback 资料与设置边界收尾

- 浏览器 fallback 禁止资料条目跨类型改写，也禁止使用原 ID 直接绕过回收站恢复流程。
- 标签输入执行数组和字符串类型校验；项目设置同步执行作品名、目标字数和字符串字段规范化。
- 状态与排序操作同步更新项目时间戳；前端回归总数达到 47 项。

## 2026-08-30：节点状态与输入边界收尾

- 桌面版节点状态更新现在拒绝不存在或已删除节点；节点上下移动使用事务，避免双写失败留下重复顺序。
- fallback 创建项目、复制/移动节点和资料写入对数值、标题和标签类型执行严格校验。
- 当前前端测试 48 项、Rust 常规测试 25 项（另有 1 项大型基准按设计忽略）。

## 2026-08-30：fallback 运行时载荷收尾

- fallback 对父节点、目标顺序、搜索参数、正文原因和资料内容执行运行时类型校验，避免外部调用写入非法结构。
- 新增 malformed payload 回归；前端测试总数达到 49 项。

## 2026-08-30：伏笔待跟进统计收尾

- “待跟进”数量现在排除“已回收”和“废弃”伏笔，仅统计仍需推进的计划中、已埋设和部分回收条目。
- 新增状态语义回归；前端测试数量保持 49 项。

## 2026-08-30：最终验收复核

- 最新提交后的大型基准再次通过：10 卷、1000 章、100 万字及资料/时间线数据命令链，耗时 51.08 秒。
- 当前自动化质量门禁保持通过；工作区干净，规格内代码项没有未勾选任务。

## 2026-08-30：首章选择逻辑收尾

- 新建、打开项目和删除节点后的自动跳转现在只从章节中选择，并按卷顺序和卷内顺序确定首章，不会误选小节。
- 新增状态流回归；前端测试总数达到 50 项。

## 2026-08-30：正文树排序入口收尾

- 统一规划初始章节、AI 上下文和快速打开中的正文树顺序：章节按卷顺序排列，小节紧随所属章节。
- 新增正文树层级排序回归；前端测试总数达到 51 项。

## 2026-08-30：章节标题引用解析收尾

- 章节引用分词现在只按逗号、分号和换行拆分，保留标题中的空格与破折号，避免“第二章 - CDP”被误拆成多个引用。
- 前后端均补充带空格/破折号标题的引用回归；前端测试总数达到 53 项，Rust 常规测试保持 25 项通过。

## 2026-08-30：章节引用 release 回归

- 重建 release EXE 与 NSIS 安装包，并在实际 WebView2 页面通过 Tauri 命令写入带空格标题的时间线引用。
- release 一致性检查返回 0 个问题，重新打开项目可读取章节和时间线数据；临时回归项目已清理。

## 2026-08-30：伏笔旧状态兼容收尾

- 一致性检查与伏笔视图统一使用状态规范化，resolved、paid_off 等历史“已回收”别名不再产生假警告。
- 新增前后端旧状态回归；前端测试总数达到 54 项，Rust 常规测试达到 26 项通过。

## 2026-08-30：伏笔兼容 release 重建

- 重建最新 release EXE 与 NSIS 安装包；独立启动 4 秒后进程仍存活且响应正常。

## 2026-08-30：PDF 导出标题收尾

- PDF 导出现在先清理 Markdown 标题、列表和行内标记，避免最终页面出现原始 #、## 等语法字符。
- 新增 PDF 导出回归断言，确保生成内容保持纯阅读文本。

## 2026-08-30：HTML 导出结构收尾

- HTML 导出改为只由正文树生成主体，标题和目录由页面包装层统一生成，避免作品标题和目录重复出现。
- 导出回归新增标题/目录去重断言。

## 2026-08-30：导出视觉与结构复核

- 最新 release 通过真实 Tauri 命令生成 HTML/PDF：HTML 标题和目录各保留一份，PDF 页面不再出现 Markdown 标记。
- DOCX 压缩包和 Word XML 结构校验通过；当前机器未安装 LibreOffice，因此无法生成 DOCX PNG 视觉中间件，已记录为环境限制。

## 2026-08-30：最终全量质量门禁复核

- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；前端 12 个测试文件 / 54 项测试。
- cargo check、cargo test 全部通过；Rust 26 项常规测试，1 项大型基准按设计忽略。
- 1000 章 / 100 万字大型基准再次通过，耗时 51.86 秒；release EXE 与 NSIS 安装包均已生成，工作区保持干净。

## 2026-08-30：P1-01 数据库恢复 UUID

- 正文节点和资料 Markdown 镜像新增轻量 NovelForge frontmatter；编辑器、统计、搜索、历史和导出均剥离内部元数据，正文仍保持普通可读 Markdown。
- 新建、保存、重命名、移动和复制会同步稳定 ID、类型、父级、状态和时间；卷使用隐藏的 .novelforge.md 元数据镜像。
- 损坏 SQLite 后按镜像恢复节点、资料、历史快照索引及原有关系；缺少元数据的旧项目继续恢复并写入明确 WARN。
- 新增关系、地点树、章节大纲/场景和历史关联恢复测试，以及旧项目兼容测试。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；12 个测试文件 / 54 项测试。
- cargo check、cargo test 全部通过；28 项 Rust 常规测试，1 项大型基准按设计忽略。

## 2026-08-30：P1-02 回收站路径复用

- 创建、复制和跨父级移动统一通过路径分配器检查活动节点、删除节点原路径、文件系统和章节 sidecar。
- 删除章节时正文与小节目录一起进入回收站；永久删除和事务失败回滚均覆盖 sidecar。
- 恢复节点在原路径可用时保留原路径，发生冲突时分配新路径并递归更新子节点路径，同时平移兄弟顺序避免重复。
- 新增删除→新建→恢复→永久删除的 Rust 集成测试，验证正文、章节小节和路径均不覆盖、不丢失。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；12 个测试文件 / 54 项测试。
- cargo check、cargo test 全部通过；29 项 Rust 常规测试，1 项大型基准按设计忽略。

## 2026-08-30：P1-03 CodeMirror 选区编辑

- 新增基于 CodeMirror transaction 的选区/光标 Markdown command，粗体、斜体、删除线和代码支持再次执行解除格式。
- 工具栏补齐标题、引用、无序/有序/任务列表、链接、图片和分割线命令；多行选区保持行级选择。
- 粗体和斜体接入命令注册表，默认 Ctrl+B/Ctrl+I，可通过现有命令面板重绑定并避免拦截普通输入框。
- 新增 Unicode 单选区、空光标、多行选区和快捷键注册回归。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；12 个测试文件 / 56 项测试。
- cargo check、cargo test 全部通过；29 项 Rust 常规测试，1 项大型基准按设计忽略。
## 2026-08-30：P1-04 Wiki 正文链接

- Wiki 语法转换为带内部 href 的标准 Markdown 链接，预览点击可打开唯一匹配的资料条目。
- 同名资料不再静默选择首个条目，预览会展示候选；编辑器通过 CodeMirror 装饰显示 Wiki 链接并支持 Ctrl/Cmd 点击。
- 缺失资料提供“去搜索”操作；搜索视图支持接收 Wiki 目标并预填全项目查询，辅助栏芯片也不再静默选择同名首项。
- 前后端 Wiki 解析均忽略 fenced code block，避免代码示例触发误报。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；12 个测试文件 / 57 项测试。
- cargo check、cargo test 全部通过；30 项 Rust 常规测试，1 个大型基准按设计忽略。

## 2026-08-30：P1-05 结构化一致性规则

- 一致性检查新增人物年龄/生日/性别结构化字段冲突提示，支持人物资料与时间线中的年龄、生日记录。
- 新增基于人物状态、死亡日期和时间线参与人的死亡后出现提醒；不扫描普通正文字符串，不把剧情文本强行判错。
- 新增人物与地点的安全相似名称提示（不自动合并），以及时间线可解析日期逆序、结束早于开始检查。
- 前后端继续共用相同 issue 字段（severity、code、title、detail、refId、refKind、path），所有新问题可从一致性页面定位。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；12 个测试文件 / 58 项测试。
- cargo check、cargo test 全部通过；31 项 Rust 常规测试，1 个大型基准按设计忽略。

## 2026-08-30：P1-06 结构化导出与格式保真

- 建立 Rust ExportDocument AST，从 Markdown 一次解析后统一渲染 TXT、HTML、DOCX、EPUB 和 PDF。
- 覆盖 H1-H6、段落、粗体、斜体、删除线、引用、无序/有序/任务列表、链接、Wiki Link、分割线、代码块和表格。
- TXT 输出清理 Markdown/Wiki 标记；HTML 输出真实语义标签和单文件 data URI 封面；DOCX 输出 Heading、Paragraph、Bold、Italic、List、Table、编号定义及可选嵌入封面。
- EPUB 输出合法 ZIP/EPUB3 结构、OPF 元数据、nav 目录、分章节 XHTML 和封面图片资源；PDF 复用 AST 纯文本并支持 JPEG 封面对象。
- 前端与 Rust 导出回归覆盖多格式结构、纯文本清理、DOCX/EPUB 资源和 HTML 封面，进入 P1 全量发布门禁。

## 2026-08-30：P1 全量质量门禁与发布复核

- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run、pnpm.cmd build 全部通过；前端 12 个测试文件 / 58 项测试，生产最大 chunk 约 364 kB。
- cargo check、cargo test 全部通过；Rust 32 项常规测试，1 项大型基准按设计 ignored。
- 1000 章 / 100 万字 ignored 基准通过，耗时 53.14 秒。
- pnpm.cmd tauri:build 通过；release EXE 与 NSIS 安装包已生成。独立 release EXE 启动 4 秒后进程仍 Responding=True，检查后正常退出。
- 已复核 TODO、PROGRESS、TEST_REPORT 和 DESKTOP_E2E_CHECKLIST；当前唯一保留的未完成项是带 WebView2 的真实桌面鼠标级人工 E2E。

## 2026-08-30：P2-01 AI 上下文增强

- 编辑器选区保存到全局状态，AI 面板可直接使用当前选中文字和当前段落，不再只能勾选整章。
- 增加最近 1/3/5/10 章快捷选择，章节依据真实卷顺序和章内顺序计算；仍保留手动选择任意章节和人物、地点、世界观、笔记等资料。
- 显示上下文字符数与预计 Token，超过 80,000 字符安全阈值时阻止发送并提示减少选择。
- 润色、改写、扩写、缩写任务的结果只允许替换选区或插入选区后，并可用 Esc 取消；普通任务仍可显式追加/替换正文。
- 新增选区/段落/最近章节/预算/结果应用回归；pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过，前端 12 个测试文件 / 61 项测试。

## 2026-08-31：P2-02 命令与存储模块化

- src-tauri/src/commands.rs 移为 commands/mod.rs，保留现有命令导出以避免前端和 Rust 集成调用路径变化。
- AI、搜索和统计命令实现已迁移到 commands/ai.rs、commands/search.rs、commands/statistics.rs；项目、正文、资料、恢复、回收站、一致性和导出边界均有独立领域模块。
- storage_impl.rs 移为 storage/mod.rs，并建立 database、filesystem、migration 子模块边界；领域 facade 为后续无行为变化迁移提供稳定入口。
- cargo check、cargo test 全部通过；32 项 Rust 常规测试通过，1 项大型基准按设计 ignored。

## 2026-08-31：P2-03 GitHub Actions CI

- 新增 .github/workflows/ci.yml，针对 main push 和 pull request 运行前端与 Rust 两个 job。
- 前端 job 固定 pnpm 11.19.0 / Node 22，执行 frozen-lockfile 安装、typecheck、lint、test 和 production build。
- Rust job 使用 stable toolchain 和缓存，执行 cargo check 与 cargo test；工作流不依赖本地生成产物。

## 2026-08-31：P2-04 单章大文件验收

- 新增 single_chapter_100k_chinese_acceptance_covers_edit_search_and_reopen Rust 测试，使用超过 100,000 个中文字符，执行打开、编辑、插入、删除、搜索、保存和重新打开。
- 定向 cargo test 通过（1 passed，约 0.13 秒）；既有 1,000 章 / 1,000,000 字 ignored 基准继续保留。
- CodeMirror 在真实 WebView2 中的帧率和滚动体感无法由当前 Rust/浏览器单测替代，已在 DESKTOP_E2E_CHECKLIST.md 增加人工记录项。

## 2026-08-31：P3-01 插件 API 与内部 Registry

- 新增 docs/PLUGIN_API.md，定义 NovelForgePlugin、PluginContext 及 command/sidebar tool/menu/generator/exporter/panel 六类扩展点。
- 新增 src/lib/plugin-registry.ts，提供进程内 PluginRegistry、唯一 ID 校验、暂存后原子合并和内置插件清单。
- builtin.name-generator 复用本地规则名字生成器，builtin.consistency 复用结构化一致性检查；当前不从磁盘加载或执行任意外部 JavaScript。
- pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run 全部通过；13 个测试文件 / 63 项测试。

## 2026-08-31：P3-02 桌面 E2E release 预检

- 重新执行 pnpm.cmd tauri:build，生产前端和 Rust release 均成功，生成 src-tauri/target/release/novelforge.exe 与 NSIS 安装包。
- 独立启动 release EXE 4 秒，进程保持运行且 Responding=True，随后正常终止；验证不依赖 Vite 开发服务器。
- 当前环境没有 tauri-driver 或 msedgedriver，无法自动完成 WebView2 鼠标级交互、FPS 和阅读器人工确认；DESKTOP_E2E_CHECKLIST.md 保持待人工勾选。

## 2026-08-31：V1.0 RC 自动门禁复核

- 前端 pnpm.cmd typecheck、pnpm.cmd lint、pnpm.cmd test -- --run、pnpm.cmd build 全部通过：13 个测试文件 / 63 项测试。
- Rust cargo check、cargo test 全部通过：33 项常规测试，1 项大型基准按设计 ignored；大型基准再次通过，耗时 54.60 秒。
- release EXE/NSIS 已重新构建并独立启动冒烟通过；真实 WebView2 鼠标级 E2E、FPS 和六种导出文件人工阅读确认仍是唯一未勾选门禁。
