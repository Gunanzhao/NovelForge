# NovelForge V1.0 RC 最终修改计划

## 1. 任务目标

你正在继续维护现有 NovelForge 仓库。

当前项目已经基本完成核心功能、数据安全、AI、一致性检查、多格式导出、GitHub Actions CI、100,000 字大文档测试和 Windows 桌面 E2E。

本轮任务不是继续扩展大型功能，而是完成 V1.0 RC 前最后一轮工程收尾。

目标：

1. 真正完成 Rust 后端模块化迁移。
2. 补齐原始任务书中仍缺失的 Markdown 脚注与完整全角/半角转换。
3. 修正文档中的重复和矛盾验收记录。
4. 对最新新增的右键菜单功能重新执行桌面专项 E2E。
5. 完成版本号、发布说明和 V1.0 RC 发布准备。
6. 保持所有现有功能和旧项目格式兼容。
7. 不进行无关的大规模重写或 UI 重做。

## 2. 当前基线

当前 `main` 已具备：

- Tauri 2 + React + TypeScript + Rust + SQLite。
- 本地 Markdown 正文。
- 卷 / 章 / 节管理。
- CodeMirror 6 编辑器。
- 自动保存、恢复、历史版本和回收站。
- 稳定 UUID Markdown frontmatter。
- 数据库损坏恢复。
- 人物、地点、世界观、时间线、伏笔、关系图。
- Wiki 双向链接。
- 一致性检查。
- OpenAI-compatible AI Provider。
- 当前选区 / 当前段落 / 最近 N 章 AI 上下文。
- Markdown / TXT / HTML / DOCX / EPUB / PDF 导出。
- GitHub Actions CI。
- Windows release EXE / NSIS。
- CDP / Tauri WebDriver / Windows UI Automation 桌面 E2E。
- 100,000 字单章桌面性能验证。
- 内部 Plugin Registry / Plugin API。
- 全局右键菜单。

不要重新实现以上模块。

## 3. 优先级

本轮按以下顺序执行：

```text
RC-01 Rust commands 模块化
RC-02 Rust storage 模块化
RC-03 Markdown 脚注
RC-04 完整全角/半角转换
RC-05 最新右键菜单桌面 E2E
RC-06 文档一致性清理
RC-07 版本与发布准备
RC-08 最终 RC 全量门禁
```

## 4. RC-01：真正完成 Rust commands 模块化

### 当前问题

当前已经存在 `src-tauri/src/commands/` 领域模块，但大部分仍只是 facade，真正的大量业务逻辑仍保留在 `commands/mod.rs` 中。

不能把“建立模块文件”视为完整模块化。

### 修改目标

将真正的业务实现从 `commands/mod.rs` 逐步迁移到：

```text
project.rs
manuscript.rs
entities.rs
recovery.rs
trash.rs
consistency.rs
export.rs
ai.rs
search.rs
statistics.rs
```

`mod.rs` 最终只负责模块声明、必要共享 helper、公共 re-export 和少量跨领域 glue。

### 推荐迁移顺序

1. `project.rs`
   - create_project
   - open_project
   - update_project
   - list_documents
   - 项目连接 / 项目元数据 helper

2. `manuscript.rs`
   - create_node
   - rename_node
   - move_node
   - copy_node
   - delete_node
   - restore_node
   - save_document
   - get_document
   - 历史版本相关正文操作
   - 节点路径分配

3. `entities.rs`
   - create/update/delete entity
   - 人物 / 地点 / 世界观 / 时间线 / 场景 / 伏笔 / 关系 / note
   - Markdown 镜像写入

4. `recovery.rs`
   - 数据库损坏隔离
   - Markdown 重建
   - 稳定 UUID 恢复
   - 旧格式兼容
   - recovery 文件读取 / 恢复

5. `trash.rs`
   - list_trash
   - restore_trash
   - permanent_delete
   - empty_trash

6. `consistency.rs`
   - check_consistency
   - 结构化规则

7. `export.rs`
   - ExportDocument / ExportBlock / ExportInline
   - Markdown parser
   - TXT / HTML / DOCX / EPUB / PDF renderer
   - 封面处理

### 模块化约束

每迁移一个领域都必须运行：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

禁止：

- 一次性移动全部代码。
- 顺便重写业务行为。
- 改变 Tauri command 名称。
- 修改前端 invoke API。
- 修改项目文件格式。
- 无必要修改数据库 Schema。

### 完成标准

`commands/mod.rs` 建议降到 30–40 KB 以下。

如果确实无法达到，应在 `DECISIONS.md` 说明原因。

以下文件不能继续只有简单 re-export：

```text
project.rs
manuscript.rs
entities.rs
recovery.rs
trash.rs
consistency.rs
export.rs
```

## 5. RC-02：真正完成 storage 模块化

当前 `storage/mod.rs` 仍承担大量实现，而 `database.rs / filesystem.rs / migration.rs` 较薄。

推荐结构：

```text
src-tauri/src/storage/
├─ mod.rs
├─ database.rs
├─ filesystem.rs
├─ migration.rs
├─ mirror.rs
├─ history.rs
├─ search_index.rs
└─ logging.rs
```

职责：

- `database.rs`：SQLite、Schema、transaction、nodes/entities/trash/history。
- `filesystem.rs`：safe_relative、atomic_write、路径校验、复制/移动、sidecar。
- `migration.rs`：formatVersion、数据库/项目迁移、旧项目兼容。
- `mirror.rs`：Markdown frontmatter、MirrorMetadata、镜像解析/生成。
- `history.rs`：history snapshot、history index、历史恢复。
- `search_index.rs`：FTS5、index_record、refresh_search_index。
- `logging.rs`：分级日志、脱敏、API Key/正文过滤。

完成后 `storage/mod.rs` 只作为聚合入口和少量共享定义。

## 6. RC-03：补齐 Markdown 脚注支持

原始规格要求脚注。

至少支持：

```markdown
这里是一段正文。[^1]

[^1]: 这里是脚注内容。
```

以及命名脚注：

```markdown
这是命名脚注。[^note]

[^note]: 详细说明。
```

要求：

- 编辑模式保留普通 Markdown。
- 预览能正确渲染脚注引用与脚注区。
- HTML / EPUB 导出支持脚注锚点。
- DOCX / PDF 至少不能丢失脚注内容；如果暂不做原生 footnote，可降级为章节末尾脚注列表。
- 增加中文脚注、多脚注、命名脚注和异常引用测试。

如需新增 remark/unified 插件，选择维护正常且与当前 ReactMarkdown 兼容的实现。

## 7. RC-04：实现真正的全角 / 半角转换

当前 `convertPunctuation()` 只属于中英文标点转换，不等于完整全半角转换。

新增：

```text
转换为全角
转换为半角
```

示例：

```text
ABC123 ↔ ＡＢＣ１２３
```

Markdown 安全要求：

默认不要破坏：

```text
Markdown 标记
行内代码
fenced code block
URL
```

普通空格默认不要自动转换为 U+3000，除非用户明确开启。

继续保留“中文标点 ↔ 英文标点”为独立功能。

测试覆盖：

```text
ABC123
ＡＢＣ１２３
中文
Markdown bold
inline code
fenced code
URL
混合文本
```

## 8. RC-05：最新右键菜单桌面专项 E2E

最近新增了全局右键菜单以及 Planning / Scene 等右键菜单。

虽然 CI 已通过，但这些修改晚于部分旧桌面验收，因此必须对当前 HEAD 再跑一次专项验证。

必测：

- 正文树：卷 / 章 / 节 / 多选。
- CodeMirror：无选区 / 有选区。
- Wiki 预览。
- Scene / 大纲 / 时间线 / 伏笔。
- 插件 context menu。
- 四角避让。
- 子菜单翻转。
- Escape 关闭。
- 点击外部关闭。
- 危险操作确认。
- 明暗主题。

Scene 菜单至少验证：

```text
打开/编辑
复制标题
复制 Markdown 路径
上移
下移
移入回收站
```

更新 `scripts/desktop-e2e-cdp.mjs`，增加清晰阶段标记，例如：

```text
CONTEXT_MENU_OK
PLANNING_CONTEXT_MENU_OK
```

然后基于当前 HEAD：

```bash
pnpm tauri build
pnpm test:e2e:desktop
```

如果本机具备 WebDriver，再运行官方 Tauri WebDriver + Native Dialog 模式。

## 9. RC-06：清理文档矛盾和重复记录

当前 `TEST_REPORT.md` 中存在重复标题和“已完成 / 尚需验收”互相冲突的记录。

不要删除历史证据，而是标注：

```markdown
> 本节为早期结果，已被后续最终验收取代。
```

同步更新：

```text
README.md
SPEC.md
TODO.md
PROGRESS.md
AUDIT_FIX_PLAN.md
TEST_REPORT.md
DECISIONS.md
CHANGELOG.md
DESKTOP_E2E_CHECKLIST.md
```

把本轮任务显式加入 TODO，在真正完成后再逐项 `[x]`。

## 10. RC-07：版本和发布准备

当前版本仍为 `0.1.0`。

本轮全部完成后统一设置：

```text
1.0.0-rc.1
```

检查并同步：

```text
package.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
Cargo.lock（如需要）
```

更新 CHANGELOG：

```markdown
## 1.0.0-rc.1

### Added
- Markdown 脚注
- 全角/半角转换
- 最新桌面右键菜单验证

### Changed
- Rust commands/storage 模块化

### Fixed
- 文档验收状态矛盾
```

根据实际修改补充。

最终门禁全部通过后准备 tag：

```bash
git tag v1.0.0-rc.1
```

如果当前环境没有 push / release 权限，不要伪造已发布。

## 11. Branch Protection 建议

如果权限允许，main 建议启用 required checks：

```text
Frontend checks
Rust checks
```

如果无法修改仓库保护规则，在 `RELEASE_CHECKLIST.md` 记录为仓库维护建议，不要声称已开启。

## 12. RC-08：最终全量门禁

Frontend：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Rust：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

大型项目重新验证：

```text
1000 章
1,000,000 字
100 人物
100 地点
200 世界观
500 时间线
100 伏笔
```

单章性能：

```text
100,000+ 中文字符
```

验证打开、编辑、搜索、保存、关闭、重开。

Windows：

```bash
pnpm tauri build
```

必须生成 release EXE + NSIS。

当前 HEAD 桌面 E2E：

```bash
pnpm test:e2e:desktop
```

应通过所有旧阶段和新增：

```text
CONTEXT_MENU_OK
PLANNING_CONTEXT_MENU_OK
```

push 后确认当前 HEAD GitHub Actions：

```text
Frontend checks = success
Rust checks = success
```

不能只引用旧 workflow run。

## 13. 代码质量要求

不要为了降低文件大小，把全部代码移动到另一个巨大文件。

禁止形式化模块化，例如：

```rust
include!("huge_file.rs");
```

Rust 尽量保持：

```text
pub(crate)
private helper
Result<T, String>
```

TypeScript 继续避免 `any` 和巨大组件。

## 14. Git 提交建议

```text
refactor(rust): move project commands into project module
refactor(rust): move manuscript commands into manuscript module
refactor(rust): move entity and recovery commands into domain modules
refactor(rust): split export and consistency implementations
refactor(storage): split database and filesystem implementation
refactor(storage): split mirrors history search and logging
feat(markdown): add footnote support
feat(writing): add fullwidth and halfwidth conversion
test(e2e): cover latest context menus on release head
docs: reconcile rc acceptance records
chore(release): prepare 1.0.0-rc.1
```

不要把整个 RC 收尾压成一个 commit。

## 15. 完成定义

只有同时满足以下条件才允许宣布：

```text
NovelForge v1.0.0-rc.1 ready
```

条件：

```text
[ ] commands/mod.rs 已真正拆分
[ ] storage/mod.rs 已真正拆分
[ ] Markdown 脚注可编辑/预览/导出
[ ] 完整全角/半角转换完成
[ ] 最新右键菜单桌面 E2E 通过
[ ] TEST_REPORT 无互相矛盾的最终状态
[ ] TODO / SPEC / README 与真实状态一致
[ ] 前端全部测试通过
[ ] Rust 全部常规测试通过
[ ] 1000章/100万字基准通过
[ ] 10万字单章验收通过
[ ] Windows release 构建通过
[ ] 当前 HEAD 桌面 E2E 通过
[ ] 当前 HEAD GitHub Actions 两个 job 成功
[ ] package / Tauri / Cargo 版本一致
[ ] CHANGELOG 已更新
```

## 16. 不属于本轮范围

不要在本轮开发：

```text
云同步
用户账号
在线插件市场
第三方未受信任插件加载
多人协作
移动端
macOS 正式适配
Linux 正式发布
大型 UI 重做
新的 AI Agent 系统
```

这些留到 V1.x / V2。

## 17. 给 Luna Max 的执行指令

从当前仓库最新 `main` 开始。

首先阅读：

```text
本文件
NovelForge 构建任务文档.md
AUDIT_FIX_PLAN.md
SPEC.md
TODO.md
PROGRESS.md
DECISIONS.md
TEST_REPORT.md
```

检查当前 HEAD 和工作区，并先运行基线测试。

然后严格按照：

```text
RC-01
↓
RC-02
↓
RC-03
↓
RC-04
↓
RC-05
↓
RC-06
↓
RC-07
↓
RC-08
```

持续执行。

每完成一个 RC 项：

```text
实现
→
定向测试
→
全量回归
→
更新文档
→
Git commit
→
继续下一项
```

除非遇到真实阻塞，否则不要因为完成一个小任务而停止。

不要降低验收条件，也不要通过修改文档把未完成任务改成“已完成”。

最终目标：

> 将当前已经成熟的 NovelForge Beta 收尾成结构清晰、规格一致、测试完整、可正式发布测试的 V1.0 Release Candidate。
