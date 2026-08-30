# NovelForge 桌面 E2E 验收清单

本清单用于在 Windows + WebView2 的真实桌面环境完成最后一项人工验收。每项都应在 release EXE 中执行：

src-tauri/target/release/novelforge.exe

## 基础工作流

- [ ] 新建项目，填写标题、作者、类型和目标字数；确认项目出现在最近项目。
- [ ] 新建卷、章、节，拖动或使用排序操作调整顺序；重命名后重新打开项目确认持久化。
- [ ] 在 Markdown 编辑器输入正文，切换编辑 / 预览 / 分栏；等待自动保存后关闭并重新打开，确认正文存在。
- [ ] 打开版本历史，查看快照并恢复一个旧版本；确认当前正文和历史记录均可读。

## 资料与规划

- [ ] 创建人物、地点、世界观、时间线、伏笔、关系和场景卡；编辑后刷新工作区确认内容保留。
- [ ] 在人物或地点资料中添加一个自定义字段；地点建立“大陆 → 国家 → 城市”层级并确认排序、父级循环防护。
- [ ] 在写作规划中分别保存作品大纲、卷大纲和章节大纲；时间线添加标签，伏笔切换到“部分回收”。
- [ ] 在正文写入 [[人物名]]，通过 Wiki 链接跳转到资料卡。
- [ ] 打开关系图，确认人物节点、关系类型 / 强度 / 备注和跳转可用。
- [ ] 打开一致性检查，确认断开的 Wiki、章节引用或关系会显示为可定位问题。
- [ ] 从系统文件选择器导入一张图片或文档；编辑附件说明后确认二进制文件仍可打开。

## 导出与统计

- [ ] 分别导出 Markdown、TXT、DOCX、EPUB、PDF；用对应阅读器打开并确认章节顺序和中文可读。
- [ ] 查看统计工作区，确认近 30 日趋势、活跃天数和章节排行随正文变化。
- [ ] 打开命令面板（Ctrl+K），搜索并执行命令；录制快捷键并验证冲突提示与恢复默认绑定。

## AI 与恢复

- [ ] 不填写 Provider 地址，执行本地续写 / 润色 / 改写 / 摘要；确认可预览、复制、追加和替换。
- [ ] 在编辑器选中一段正文，执行润色 / 改写 / 扩写 / 缩写；确认结果可复制、按 Esc 取消、替换选区或插入选区后，不会隐式覆盖整章。
- [ ] 勾选正文和资料上下文，选择最近 1 / 3 / 5 / 10 章，确认上下文预览只包含明确选择的内容并显示字符数 / Token 预算及超限提示。
- [ ] 模拟关闭或中断保存流程后重新打开，确认恢复提示、回收站恢复和永久删除边界正确。
- [ ] 在测试副本中将 SQLite 文件改名或损坏后重新打开，确认正文和资料 Markdown 镜像仍可读取，设置页能查看脱敏应用日志。
- [ ] 使用 F11、主题切换和侧栏折叠，确认窗口布局和偏好持久化。

## 大文件性能（人工桌面）

- [ ] 在 release EXE 中打开包含至少 100,000 个中文字符的单章，完成插入、删除、搜索、保存、关闭和重开；记录打开 / 保存耗时、滚动是否卡顿及编辑器是否保持可用。
- [ ] 若使用性能工具，记录编辑器滚动期间 FPS；当前自动化仅覆盖 Rust 真实命令链，无法替代 WebView2 / CodeMirror 的人工帧率观察。

## 结果记录

- 验收日期：__________
- release 版本 / commit：__________
- 未通过项与截图：________________________________

## 自动化记录

- 直连命令：pnpm.cmd test:e2e:desktop
- 官方 WebDriver + 原生对话框命令（需设置与当前 WebView2 匹配的 EDGE_DRIVER_PATH）：
  $env:NOVELFORGE_E2E_WEBDRIVER='1'; $env:NOVELFORGE_E2E_NATIVE_DIALOGS='1'; pnpm.cmd test:e2e:desktop
- 可选大文档性能命令（在上述两种模式分别设置 NOVELFORGE_E2E_FPS='1'）：
  $env:NOVELFORGE_E2E_FPS='1'; pnpm.cmd test:e2e:desktop
- 带测试封面的导出复现（仅直连 CDP；保留项目目录供阅读器检查）：
  $env:NOVELFORGE_E2E_COVER='1'; $env:NOVELFORGE_E2E_KEEP_PROJECT='1'; pnpm.cmd test:e2e:desktop
- 上述封面模式复制 src-tauri/icons/icon.png 到项目 attachments/cover.png，导出对话框自动填写该相对路径，并输出 E2E_PROJECT_PATH；不要把测试封面当作生产素材。
- 自动化结果（2026-08-31）：CORE_EDITOR_TREE_OK、DRAG_DROP_OK、HISTORY_AND_TREE_ACTIONS_OK、ENTITY_CRUD_OK、WIKI_NAVIGATION_OK、SETTINGS_COMMANDS_OK、RECOVERY_FAILURE_OK、NATIVE_DIALOGS_OK、PLANNING_AND_CHECKS_OK、SEARCH_OK、AI_SELECTION_AND_CANCEL_OK、AI_PROVIDER_OK、TRASH_RESTORE_OK、EXPORTS_OK。
- 性能采样结果（2026-08-31）：直连模式 2 秒 286 帧（约 142.8 FPS），WebDriver + 原生对话框模式 2 秒 278 帧（约 139.0 FPS）；真实 editor-pane 内容约 57,030 / 58,140 px、视口 670 px，替换约 655 / 715 ms、保存约 260 / 292 ms。
- 覆盖说明：脚本在隔离 WebView2 用户目录中启动 release EXE；官方 tauri-driver + WebDriver 覆盖真实会话，UI Automation 覆盖原生文件夹/文件选择器，WebDriver 对话框事件覆盖确认/提示框。恢复流程会关闭并重新启动应用，验证恢复提示、预览、恢复写回和恢复目录清理。
- 仍需人工记录：CodeMirror 在 100,000 字单章中的滚动输入体感，以及 Markdown/TXT/HTML/DOCX/EPUB 五种导出物的逐页视觉细节（中文、粗体、列表、标题、目录、封面与章节顺序）。PDF 已在本机 Edge 与 SumatraPDF 中完成中文、封面和页面显示核对。上述 FPS 是真实 WebView2 rAF/overflow 容器的量化补充，不能替代主观体感。

### 阅读器冒烟记录（2026-08-31）

- Markdown：记事本标签页标题为导出文件名，UI Automation 文本读取到作品名、目录、章节和“恢复验收内容”。
- TXT：记事本标签页标题为导出文件名，UI Automation 文本读取到作品名、卷章顺序和正文。
- HTML：独立 Edge 窗口标题为导出文件名，页面已加载。
- DOCX：LibreOffice Portable Writer 窗口标题为导出文件名并标记“只读”；无界面 soffice --convert-to pdf 返回 0 并生成 PDF。
- EPUB：Calibre Portable 窗口标题为“CDP 桌面验收 [EPUB] — 电子书阅读器”，UI Automation 读取到目录和中文阅读器界面。
- PDF：commit e9ed8f3 生成的嵌入中文字体版本已在独立 Edge 与 SumatraPDF 3.6.1 中实际打开；两者均显示 1 页，标题、作者、章节中文和测试封面清晰可读，Poppler 文本/图像提取同步通过。

### 带测试封面复核（2026-08-31）

- commit 0710bbd 的 NOVELFORGE_E2E_COVER=1 + NOVELFORGE_E2E_KEEP_PROJECT=1 直连运行通过全部 E2E 标记和 FPS 采样（约 142.9 FPS），最新保留项目目录：C:\Users\Jiang\AppData\Local\Temp\novelforge-desktop-e2e-project-33364。
- 该项目生成六种导出物；HTML 的 Edge UI Automation 文本包含标题、目录、中文正文和图片占位，说明页面及封面资源已加载。
- DOCX 的 LibreOffice Portable Writer 窗口已打开；7-Zip 检查到 word/media/cover.png。EPUB 的 Calibre Portable 窗口已打开并显示目录；7-Zip 检查到 OEBPS/images/cover.png。
- Markdown/TXT 记事本 UI Automation 读取到标题、目录、卷章顺序和中文正文；PDF 在 Edge 与 SumatraPDF 中均显示 1 页，中文与封面视觉核对通过。
- 以上是带真实封面夹具的加载/结构证据；PDF 视觉门禁已完成，Markdown/TXT/HTML/DOCX/EPUB 的逐页视觉细节和编辑器滚动/输入体感仍需人工签核。
