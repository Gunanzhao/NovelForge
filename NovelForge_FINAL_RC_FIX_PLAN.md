# NovelForge V1.0 RC 最终修正计划

## 1. 任务目标

你正在继续维护现有 NovelForge 仓库。

当前项目主体功能已经基本完成。本轮不是继续扩展大型功能，而是完成 V1.0 RC 最后一轮规格与发布收尾。

本轮只处理以下 6 项：

1. 真正完成 Markdown 脚注的编辑器预览。
2. 明确并统一“全角 / 半角转换”的产品规格、代码和测试。
3. 重新完成 WebDriver + Native Dialog 桌面 E2E。
4. 修正 TODO / TEST_REPORT / RELEASE_CHECKLIST 等文档中的状态偏差。
5. 创建正式 GitHub RC Release 并附 Windows 安装包。
6. 如权限允许，为 `main` 启用 CI Required Checks。

不要增加新功能，不要重新进行大规模重构。

---

## 2. 当前基线

当前仓库已经具备：

- Tauri 2 + React + TypeScript + CodeMirror 6 + Rust + SQLite。
- 本地 Markdown 正文、自动保存、崩溃恢复、历史版本和回收站。
- 人物 / 地点 / 世界观 / 时间线 / 伏笔 / 关系图。
- Wiki Link、一致性检查、AI Provider、选区 AI、最近 N 章上下文。
- Markdown / TXT / HTML / DOCX / EPUB / PDF 导出。
- GitHub Actions CI、Plugin Registry、全局右键菜单。
- Windows release EXE / NSIS。
- 1000 章 / 100 万字基准与 100000 字单章性能验证。
- CDP 与 Tauri WebDriver 桌面 E2E。
- Rust `commands` 与 `storage` 已完成真实领域拆分。

不要重复开发以上模块。

---

## 3. 开始前检查

执行：

```bash
git status
git log -5 --oneline

pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build

cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

如果基线失败，先定位当前 `main` 是否已有问题，不要直接开始新修改。

---

# FIX-01：真正完成 Markdown 脚注预览

## 当前问题

项目已有：

```text
parseFootnotes()
FootnoteReference
FootnoteDefinition
HTML / EPUB / DOCX / PDF 脚注导出基础
```

但编辑器预览仍主要使用：

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>
```

这不足以证明：

```markdown
正文[^1]

[^1]: 脚注说明
```

能在预览区真正渲染成脚注。

当前前端测试主要验证“脚注解析”，还缺 React 组件级“脚注渲染”测试。

## 修改目标

预览模式必须真正支持：

```markdown
正文[^1]

[^1]: 中文脚注内容
```

以及：

```markdown
正文[^note]

[^note]: 命名脚注内容
```

预览应产生脚注引用和脚注区，并支持正文到脚注、脚注返回正文的锚点跳转。

## 实现原则

优先采用 ReactMarkdown / unified 生态中维护正常的脚注方案。

保持现有：

```text
ReactMarkdown
remark-gfm
Wiki Link
```

架构，不要用正则重写整篇 Markdown HTML。

## 必测情况

- 普通编号脚注。
- 命名脚注。
- 多个脚注。
- 同一脚注多次引用。
- 中文脚注。
- inline code 中伪脚注不解析。
- fenced code 中伪脚注不解析。

新增组件级测试，例如：

```text
tests/editor-footnote.test.tsx
```

至少断言：

```text
脚注引用节点存在
脚注内容存在
href / id 对应
重复引用正确
代码区不被解析
```

完成后重新运行全部导出回归，确保 HTML / EPUB / DOCX / PDF / TXT 不退化。

---

# FIX-02：统一全角 / 半角转换规格

## 当前问题

当前 `convertFullwidth()` / `convertHalfwidth()` 主要转换：

```text
A-Z
a-z
0-9
可选空格
```

并保护 inline code、fenced code、URL。

但“全角 / 半角转换”这个名称会让用户理解为完整 ASCII 字符范围，例如：

```text
! → ！
( → （
) → ）
@ → ＠
: → ：
```

当前实现并未覆盖这些。

## 推荐方案 A：实现完整安全 ASCII 全半角转换

支持：

```text
U+0021 ~ U+007E
↔
U+FF01 ~ U+FF5E
```

包括字母、数字与常用 ASCII 标点。

### Markdown 安全

禁止机械转换整篇 Markdown 源码。

例如：

```markdown
**ABC**
```

应变成：

```markdown
**ＡＢＣ**
```

禁止：

```text
＊＊ＡＢＣ＊＊
```

至少保护：

```text
Markdown 标记
inline code
fenced code
URL
Wiki Link 语法
Markdown 链接地址
图片地址
frontmatter
```

普通空格默认不转换；可选开启 U+0020 ↔ U+3000。

已有“中文标点 ↔ 英文标点”继续作为独立功能。

## 方案 B：缩小功能定义

如果完整 ASCII 转换会显著增加 Markdown 破坏风险，可以把功能正式改名为：

```text
英数字全角转换
英数字半角转换
```

然后同步修改：

```text
UI
README.md
SPEC.md
TODO.md
CHANGELOG.md
DECISIONS.md
```

不得继续把它描述为“完整全角 / 半角转换”。

优先采用方案 A；只有确认风险明显时才采用方案 B，并记录 ADR。

## 测试

至少覆盖：

```text
ABC123
ＡＢＣ１２３
!@#$%^&*()
！＠＃＄％＾＆＊（）
Markdown bold
Markdown italic
Markdown heading
Markdown list
inline code
fenced code
URL
Markdown link
image
Wiki Link
中文
中英混合
```

验证 full → half、half → full 的稳定性。

---

# FIX-03：完成 WebDriver + Native Dialog E2E

## 当前状态

已经通过：

```text
CDP release E2E
Tauri WebDriver WebView2 E2E
CONTEXT_MENU_OK
PLANNING_CONTEXT_MENU_OK
EXPORTS_OK
```

当前唯一未完全关闭的是：

```text
Tauri WebDriver + Native Dialog
```

附件原生文件选择器存在 Windows 焦点 / 列表刷新竞态。

## 本轮目标

不要重写现有 E2E，只增强原生文件选择器自动化稳定性。

重点检查：

```text
窗口是否真正前台
文件选择器是否加载完成
文件列表是否刷新完成
selector 是否依赖不稳定 index
输入路径后是否等待刷新
确认按钮是否 enabled
```

优先使用条件等待而不是固定 sleep。

可以实现：

```text
waitUntil()
poll
timeout
```

必要时重新定位窗口并恢复焦点。

优先直接向文件名输入框或地址栏输入完整测试文件路径，避免依赖文件列表第 N 项。

针对明确的 UI race 最多允许 2~3 次有限重试，禁止无限重试把失败“刷成成功”。

只有真实完成：

```text
打开原生对话框
选择真实文件
确认
应用收到附件
附件显示在资料库
```

后才输出：

```text
NATIVE_DIALOGS_OK
```

测试文件使用临时目录创建并在结束后清理。

---

# FIX-04：修正文档状态

在 FIX-01 / FIX-02 真正通过前，不应把：

```text
Markdown 脚注预览
完整全角/半角转换
```

继续标为完全完成。

检查并同步：

```text
TODO.md
AUDIT_FIX_PLAN.md
PROGRESS.md
TEST_REPORT.md
RELEASE_CHECKLIST.md
README.md
SPEC.md
CHANGELOG.md
DECISIONS.md
```

不要删除历史记录；旧记录可加：

```markdown
> 历史记录：该项曾标记完成，后续 RC 审计发现预览/规格仍不完整，最终状态以下方 Final Validation 为准。
```

---

# FIX-05：创建正式 GitHub Release

当前已有远程 tag，但 GitHub Releases 仍为空。

最终需要创建：

```text
NovelForge v1.0.0-rc.x
```

并标记为：

```text
Pre-release
```

不要标记成正式稳定版。

## Release Notes 至少包含

### Overview
NovelForge 是本地优先的中文长篇小说 Markdown 创作工作台。

### Highlights
- Markdown 小说写作
- 人物 / 地点 / 世界观
- 时间线
- 伏笔
- 关系图
- 一致性检查
- AI 辅助
- 多格式导出
- 数据恢复

### Data Safety
说明正文为普通 Markdown，SQLite 主要保存元数据和索引，并支持 recovery / history / trash。

### AI
说明 AI 为可选功能，不填写 API Key 核心功能仍可正常使用。

### Platform
Windows 11 x64。

### Known Issues
如果 Native Dialog E2E 仍存在系统焦点竞态，要如实记录。

## 安装包

上传：

```text
NovelForge_<version>_x64-setup.exe
```

不要上传 target、node_modules 或构建缓存。

## 版本规则

如果本轮 FIX-01 / FIX-02 修改了生产代码，而 `v1.0.0-rc.1` 已公开推送：

不要移动已公开 tag。

优先升级：

```text
v1.0.0-rc.2
```

并同步：

```text
package.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
Cargo.lock
CHANGELOG.md
```

如果本轮只补验证和文档、没有生产代码变化，则可以保留 rc.1。

---

# FIX-06：Main Branch Required Checks

如果 GitHub 权限允许，为 `main` 启用：

```text
Require status checks before merging
```

Required：

```text
Frontend checks
Rust checks
```

建议同时启用：

```text
Require branch to be up to date before merging
```

如果当前权限无法修改，不要伪造完成。

在 `RELEASE_CHECKLIST.md` 保留管理员待办，并注明需要在 GitHub Settings / Rulesets 中启用。

---

# 7. 最终全量门禁

完成 FIX-01 ~ FIX-04 后执行。

## Frontend

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Rust

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 大型验收

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
```

重新验证 1000 章 / 100 万字。

## Windows Build

```bash
pnpm tauri build
```

## Desktop E2E

CDP：

```bash
pnpm test:e2e:desktop
```

必须出现现有所有阶段以及：

```text
CONTEXT_MENU_OK
PLANNING_CONTEXT_MENU_OK
EXPORTS_OK
```

随后运行 WebDriver 和 WebDriver + Native Dialog 模式。

尽量取得：

```text
NATIVE_DIALOGS_OK
```

如果明确属于系统级焦点限制而仍无法稳定，必须在：

```text
TEST_REPORT.md
RELEASE_CHECKLIST.md
GitHub Release Notes
```

中记录，不得伪装通过。

---

# 8. GitHub Actions

最终代码 push 后必须确认最新 HEAD：

```text
Frontend checks = success
Rust checks = success
```

不能引用旧 commit 的 workflow run。

---

# 9. Git Commit 建议

```text
fix(markdown): render footnotes in editor preview
test(markdown): cover rendered footnote navigation
feat(writing): complete markdown-safe width conversion
test(e2e): stabilize native attachment dialog automation
docs: reconcile final rc validation status
chore(release): prepare next rc release
```

如果最终选择方案 B：

```text
docs(writing): clarify alphanumeric width conversion scope
```

---

# 10. 禁止事项

禁止：

```text
为了通过 E2E 删除 Native Dialog 测试
把失败测试改成 skip
把脚注解析测试冒充预览测试
把英数字转换继续描述成完整 ASCII 全角转换
重新大规模重构已稳定的 Rust 模块
重新实现 AI / export / recovery
强行重写已公开 tag
```

---

# 11. 完成定义

只有以下全部满足，才能关闭本轮：

```text
[ ] 脚注在 React Markdown 预览中真实渲染
[ ] 脚注组件级测试通过
[ ] 脚注导出回归通过
[ ] 全半角转换规格已明确
[ ] 代码 / UI / SPEC / README 对定义一致
[ ] 转换范围测试完整
[ ] CDP E2E 通过
[ ] WebDriver E2E 通过
[ ] Native Dialog E2E 通过或明确记录系统级限制
[ ] TODO / TEST_REPORT / RELEASE_CHECKLIST 状态真实
[ ] Frontend 全量测试通过
[ ] Rust 全量测试通过
[ ] 1000章 / 100万字基准通过
[ ] Tauri release 构建通过
[ ] 最新 HEAD GitHub Actions 全部 success
[ ] GitHub RC Release 已创建
[ ] Windows 安装包已附加
[ ] 分支保护已开启或明确记录为管理员待办
```

---

# 12. 给 Codex 的执行指令

从当前仓库最新 `main` 开始。

先阅读：

```text
本文件
NovelForge 构建任务文档.md
AUDIT_FIX_PLAN.md
TODO.md
PROGRESS.md
TEST_REPORT.md
RELEASE_CHECKLIST.md
DECISIONS.md
CHANGELOG.md
```

然后按顺序执行：

```text
1. 运行基线
2. FIX-01 脚注预览
3. FIX-02 全半角规格与实现
4. 全量测试
5. FIX-03 Native Dialog E2E
6. FIX-04 文档状态清理
7. 判断 rc.1 / rc.2
8. 构建 release
9. 推送最终代码
10. 验证最新 GitHub Actions
11. 创建 GitHub Pre-release
12. 上传 Windows 安装包
13. 更新最终 TEST_REPORT / RELEASE_CHECKLIST
```

没有真实阻塞时持续执行，不要完成一个小步骤就停止。

最终目标：

> 消除 NovelForge V1.0 RC 最后几个预览、规格、E2E 与发布流程缺口，使仓库文档、实际实现、自动测试和公开发布结果完全一致。
