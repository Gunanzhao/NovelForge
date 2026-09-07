# NovelForge 审计修复与 V1.0 收尾计划

## 1. 任务目标

你正在继续维护现有 NovelForge 仓库。

不要重写项目，不要推翻现有架构，不要删除已经正常工作的功能。

本轮任务目标：

1. 修复完整仓库审计中发现的真实缺陷。
2. 补齐原始《NovelForge 构建任务文档》与当前实现之间的重要差距。
3. 强化数据恢复、编辑器、导出、一致性检查和自动测试。
4. 将项目从当前 Beta 状态推进到可进行 V1.0 桌面验收的状态。
5. 保持现有项目格式兼容。
6. 不破坏已有用户项目。
7. 所有修改必须有自动测试或明确的人工验收步骤。

---

# 2. 开发原则

必须遵守以下原则。

## 2.1 禁止大规模重写

优先：

```text
修复
重构
增量扩展
补测试
```

禁止：

```text
整个重写前端
整个重写 Rust 后端
删除现有数据库结构重新开始
更改现有项目格式导致旧项目无法打开
```

---

## 2.2 数据安全优先级最高

任何涉及：

```text
正文
资料
项目树
UUID
历史版本
回收站
数据库恢复
```

的修改，都必须首先考虑已有项目兼容和数据不丢失。

在不能确定数据迁移安全时：

```text
宁可拒绝操作
不要自动破坏数据
```

---

## 2.3 测试优先

修复 Bug 时：

```text
先增加能够复现问题的测试
再修改实现
最后确保测试通过
```

新功能必须补测试。

---

# 3. 开始开发前

首先执行：

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test

cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

然后阅读：

```text
NovelForge 构建任务文档.md
SPEC.md
TODO.md
PROGRESS.md
DECISIONS.md
CHANGELOG.md
TEST_REPORT.md
DESKTOP_E2E_CHECKLIST.md
```

检查当前 Git 状态：

```bash
git status
```

确保理解现有代码后再开始修改。

---

# 4. 建立新的修复跟踪文档

创建：

```text
AUDIT_FIX_PLAN.md
```

其中记录以下状态：

```text
[ ] 未开始
[~] 进行中
[x] 完成
[!] 阻塞
```

至少包含：

```text
P1-01 数据库恢复 UUID
P1-02 回收站路径复用
P1-03 CodeMirror 选区编辑
P1-04 Wiki 正文链接
P1-05 一致性规则
P1-06 导出格式保真
P2-01 AI 上下文
P2-02 commands.rs 模块化
P2-03 CI
P2-04 大文件性能
P3-01 插件 API 设计
P3-02 桌面 E2E
```

每完成一项：

1. 更新 `AUDIT_FIX_PLAN.md`
2. 更新 `PROGRESS.md`
3. 必要时更新 `CHANGELOG.md`
4. 运行相关测试
5. 提交一个语义清晰的 Git commit

不要一次把所有改动塞进一个 commit。

---

# 5. P1-01：修复 SQLite 灾难恢复的 UUID 断链

这是本轮最高优先级任务。

## 当前问题

数据库损坏后，NovelForge 会从 Markdown 文件重新建立：

```text
nodes
entities
```

但是当前恢复过程中会重新生成 UUID。

这会破坏以 UUID 建立的关联，例如：

```text
人物关系：
fromId
toId

地点：
parentId

大纲 / Scene：
chapterId

其它资料：
entityId / nodeId
```

同时可能造成：

```text
历史版本
recovery
资料引用
```

与新 UUID 断开。

---

## 修改目标

项目经过：

```text
数据库损坏
↓
隔离 database.sqlite
↓
从 Markdown 重建
```

之后，应尽可能保留原 UUID 和关联关系。

---

## 推荐方案

为正文节点和资料 Markdown 镜像增加稳定元数据。

优先考虑 Markdown frontmatter，例如：

```markdown
---
novelforgeId: 550e8400-e29b-41d4-a716-446655440000
novelforgeKind: character
createdAt: 2026-08-30T00:00:00Z
updatedAt: 2026-08-30T00:00:00Z
---

# 林月
```

正文节点也应保存：

```yaml
novelforgeId:
novelforgeKind:
parentId:
status:
```

但必须保证：

```text
正文依然是普通可读 Markdown
```

不得把大量内部 JSON 塞入正文。

---

## 兼容旧项目

旧项目没有 frontmatter 时：

1. 继续允许恢复。
2. 生成新的 UUID。
3. 尝试通过：
   - 文件路径
   - 标题
   - 类型
   - 关系目标
   进行二次关联恢复。
4. 给日志写入明确 WARN。
5. 不得静默声称“完全恢复”。

---

## 数据库恢复验证

增加 Rust 测试：

### Case A

创建：

```text
人物A
人物B
人物A -> 人物B 的关系
```

损坏 SQLite。

重新打开项目。

验证：

```text
人物A ID 未变化
人物B ID 未变化
relationship.fromId 正确
relationship.toId 正确
关系图仍有效
```

### Case B

创建地点：

```text
大陆
└─ 国家
   └─ 城市
```

损坏数据库。

恢复后验证：

```text
parentId 关系仍正确
```

### Case C

创建：

```text
章节
Scene
大纲
时间线章节关联
```

损坏数据库。

验证关联仍有效。

---

# 6. P1-02：修复回收站与节点路径复用问题

## 当前风险

例如：

```text
chapter_001.md
chapter_002.md
```

删除 `chapter_002.md` 后，它进入回收站。

此时创建新章节，不能重新使用：

```text
chapter_002.md
```

否则恢复旧章节时会发生文件路径冲突。

---

## 修改要求

新的节点路径分配算法必须同时检查：

```text
活动节点
已删除节点
trash 中记录的 original_path
实际文件系统
章节 sidecar 目录
```

不能仅使用：

```text
MAX(order_index) + 1
```

来决定文件编号。

---

## 推荐方案

统一使用现有：

```text
next_node_location()
```

或重构出：

```text
allocate_node_path()
```

所有：

```text
create
copy
move
restore
```

均使用相同路径分配规则。

---

## 测试

必须增加：

```text
创建 chapter_001
创建 chapter_002

删除 chapter_002

创建新章节

恢复旧 chapter_002
```

要求：

```text
恢复成功
两个章节内容都保留
没有覆盖
没有丢失
文件路径唯一
```

---

# 7. P1-03：重做 CodeMirror Markdown 格式操作

当前格式工具按钮不能只在文档末尾追加：

```markdown
**文字**
```

必须真正作用于：

```text
当前 selection
当前 cursor
```

---

## 必须支持

### 粗体

选中：

```text
林月
```

Ctrl+B：

```markdown
**林月**
```

再次执行应尽可能解除粗体。

---

### 斜体

Ctrl+I：

```markdown
*林月*
```

---

## 同时完善工具栏

支持：

```text
粗体
斜体
删除线
标题
引用
无序列表
有序列表
任务列表
链接
图片
分割线
代码
```

如果暂时不增加按钮，也至少完成底层 command。

---

## CodeMirror 实现原则

不要通过：

```text
读取全文字符串
重新拼接整篇文档
```

完成普通格式编辑。

使用：

```text
EditorView
EditorState
transaction
selection
dispatch
```

---

## 快捷键

至少增加：

```text
Ctrl+B
Ctrl+I
```

并整合到现有快捷键系统。

必须支持用户重绑定。

---

## 测试

增加针对 Markdown command 的单元测试：

```text
无选区
单选区
多行选区
已加粗文本
Unicode 中文
```

---

# 8. P1-04：实现正文中的真正 Wiki 链接

当前：

```text
[[人物名]]
```

不能只渲染成粗体。

---

## 预览模式

必须渲染为可点击条目：

```text
[[林月]]
```

点击后：

```text
打开人物 / 地点 / 世界观资料
```

---

## 编辑模式

推荐使用 CodeMirror Decoration。

Wiki Link：

```text
[[林月]]
```

应具有视觉提示。

可以：

```text
Ctrl + 点击
```

或：

```text
点击 Wiki 装饰区域
```

跳转。

---

## 同名处理

如果存在多个同名资料：

不能静默打开第一项。

应：

```text
显示候选
```

或进入：

```text
搜索 / 选择界面
```

---

## Broken Wiki

不存在目标时：

```text
[[不存在的条目]]
```

显示为 missing 状态。

点击可以：

```text
创建对应资料
```

或：

```text
搜索
```

---

# 9. P1-05：补齐原始任务书的一致性检查

保留现有：

```text
missing wiki
重复标题
broken relationship
章节引用
伏笔状态
```

然后新增第一阶段规则。

---

## 9.1 人物年龄冲突

检查人物资料和正文/时间线中的结构化信息。

发现：

```text
同一人物出现明显不同年龄
```

输出：

```text
可能存在年龄冲突
```

不得自动声称一定错误。

---

## 9.2 生日冲突

同一个人物存在多个不同生日描述时提示。

---

## 9.3 死亡后出现

如果人物状态为：

```text
死亡
已死亡
dead
deceased
```

且死亡事件之后仍被时间线标记为正常活动：

提示：

```text
人物可能在死亡事件之后继续出现
```

不要检查普通正文字符串来强行判定剧情错误。

优先使用：

```text
时间线
人物状态
章节关联
```

等结构化数据。

---

## 9.4 人物名称疑似拼写变化

实现简单安全的相似名称检测。

例如：

```text
林月
林玥
```

不要自动合并。

只显示：

```text
名称可能相似
```

---

## 9.5 性别描述冲突

基于人物结构化字段进行。

不要根据自然语言正文强推断。

---

## 9.6 地点名称疑似变化

同类型地点名称高度相似时提示。

---

## 9.7 时间线顺序

检测：

```text
明显可解析日期逆序
```

以及：

```text
结束时间 < 开始时间
```

如果未来有这些字段。

---

## 一致性系统要求

每条 issue 应包含：

```text
severity
code
title
detail
refId
refKind
path
```

并可以在 UI 中定位。

---

# 10. P1-06：重构导出系统

当前 DOCX / EPUB / HTML / PDF 不应再通过简单：

```text
逐行 Markdown → 普通文本
```

生成。

---

## 建立统一导出 AST

推荐：

```text
Markdown
↓
Markdown AST
↓
Export Document Model
↓
HTML
DOCX
EPUB
PDF
TXT
```

Rust 或 TypeScript 均可实现。

但最终生产导出仍建议放在 Rust。

---

## 至少正确处理

```text
H1-H6
普通段落
粗体
斜体
删除线
引用
无序列表
有序列表
任务列表
链接
Wiki Link
分割线
代码
表格
```

脚注如果编辑器已支持，也应该同步支持。

---

## TXT

继续输出真正纯文本：

```text
去 Markdown 标记
去 Wiki 双括号
保留正常段落
```

---

## DOCX

必须真正生成：

```text
Heading
Paragraph
Bold
Italic
List
```

不能只验证：

```text
word/document.xml 存在
```

---

## EPUB

需要：

```text
合法 EPUB3
真实章节导航
目录
元数据
章节分割
```

---

## PDF

至少：

```text
中文字体正常
分页正常
标题层级
段落缩进
基本排版
```

---

## 封面

当前封面参数必须统一定义。

支持的格式应明确为：

```text
HTML
EPUB
DOCX
PDF
```

如果某种格式暂时不支持封面：

UI 不应该显示对应选项。

---

## HTML 封面路径

导出的 HTML 位于：

```text
.novelforge/exports/
```

因此不能简单输出：

```html
<img src="attachments/cover.jpg">
```

推荐：

```text
复制封面到 exports/assets/
```

或者：

```text
转 data URI
```

单文件 HTML 推荐 data URI。

---

# 11. P2-01：增强 AI 上下文系统

现有显式选择上下文机制保留。

新增：

```text
当前选中文字
当前段落
当前章节
最近 N 章
指定章节
指定人物
指定地点
指定世界观
指定笔记
```

---

## 选区 AI

CodeMirror selection 必须可以直接传给：

```text
润色
改写
扩写
缩写
```

AI 返回后：

```text
预览
替换选区
插入选区后
复制
取消
```

不能强制替换整个章节。

---

## 最近 N 章

提供：

```text
1
3
5
10
```

等选项。

必须根据真实：

```text
卷顺序
章节顺序
```

计算。

---

## 上下文预算

显示：

```text
字符数
预计 Token
```

超过安全阈值时提醒用户减少上下文。

---

# 12. P2-02：拆分 Rust commands.rs

不要一次重写。

采用逐步迁移。

推荐结构：

```text
src-tauri/src/
├─ commands/
│  ├─ mod.rs
│  ├─ project.rs
│  ├─ manuscript.rs
│  ├─ entities.rs
│  ├─ recovery.rs
│  ├─ trash.rs
│  ├─ search.rs
│  ├─ statistics.rs
│  ├─ consistency.rs
│  ├─ export.rs
│  └─ ai.rs
│
├─ storage/
│  ├─ mod.rs
│  ├─ database.rs
│  ├─ filesystem.rs
│  └─ migration.rs
```

---

## 拆分原则

每次只移动一个模块。

每移动一次：

```bash
cargo check
cargo test
```

不要为了“代码漂亮”修改业务行为。

---

# 13. P2-03：增加 GitHub Actions CI

创建：

```text
.github/workflows/ci.yml
```

至少执行：

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test

cargo check
cargo test
```

如果 Windows runner 成本允许，再增加：

```text
pnpm tauri build
```

---

## CI 要求

任何 PR / push 到主开发分支都执行。

不要依赖开发者本机 `TEST_REPORT.md` 才判断通过。

---

# 14. P2-04：补真实大文件性能测试

当前已有：

```text
1000章
100万字
```

测试。

保留。

新增：

```text
单章节 100000 中文字符
```

---

## 验收

测试：

```text
打开
编辑
插入
删除
搜索
保存
重新打开
```

不能只测字符串算法。

如果无法完全自动测试 CodeMirror FPS：

在：

```text
DESKTOP_E2E_CHECKLIST.md
```

增加明确人工测试。

---

# 15. P3-01：插件系统先设计接口，不急于运行第三方代码

不要马上实现复杂插件沙箱。

先创建：

```text
docs/PLUGIN_API.md
```

定义：

```ts
interface NovelForgePlugin {
  id: string
  name: string
  version: string

  register(context: PluginContext): void
}
```

未来允许注册：

```text
command
sidebar tool
menu
generator
exporter
panel
```

---

## 第一阶段

只实现内部 Plugin Registry。

例如内置：

```text
名字生成器
一致性检查
```

也可以通过同一个注册接口加载。

暂时不允许任意外部 JS 执行。

---

# 16. P3-02：完成真实桌面 E2E

在上述 P1/P2 修复完成后执行。

更新：

```text
DESKTOP_E2E_CHECKLIST.md
```

逐项真实运行：

```text
Windows 11
Release EXE
WebView2
```

---

## 必测流程

### 项目

```text
新建
打开
关闭
最近项目
设置
```

### 正文

```text
新建卷
新建章
新建节
重命名
任意位置拖拽
跨卷移动
复制
批量删除
恢复
```

### 编辑器

```text
Ctrl+B
Ctrl+I
Wiki Link
预览
分栏
自动保存
关闭重开
```

### 历史/恢复

```text
版本历史
Diff
恢复旧版本
模拟保存失败
Recovery
```

### 资料

```text
人物
地点树
世界观
时间线
伏笔
关系图
附件
```

### AI

```text
本地模式
Provider 模式
选区 AI
最近 N 章
明确上下文
```

### 导出

用真实软件打开：

```text
Markdown
TXT
HTML
DOCX
EPUB
PDF
```

尤其验证：

```text
中文
粗体
列表
标题
目录
封面
章节顺序
```

---

# 17. 文档修正

不要再让 TODO 给出“只剩 E2E”的错误印象。

修改：

```text
README.md
TODO.md
PROGRESS.md
SPEC.md
```

使它们反映真实情况。

---

## SPEC.md

原始构建任务书仍应视为最高层需求来源之一。

不要通过删减 SPEC 让任务“自动完成”。

如果功能：

```text
延期
修改
删除
```

必须写进：

```text
DECISIONS.md
```

---

# 18. 自动测试目标

完成本轮后至少应覆盖：

```text
数据库 UUID 灾难恢复
关系恢复
地点树恢复
章节关联恢复
回收站路径碰撞
选区 Markdown command
Wiki Link 解析/跳转
一致性新增规则
导出 AST
HTML 封面
DOCX 格式
EPUB 导航
AI 选区
AI 最近 N 章
100000 字单章节
```

---

# 19. 每阶段质量门禁

每完成一个 P1 项必须执行：

```bash
pnpm typecheck
pnpm lint
pnpm test

cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

P1 全部完成后执行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
pnpm tauri build
```

不得只运行新增测试。

---

# 20. Git 提交建议

推荐：

```text
test(recovery): cover stable ids after database rebuild
fix(recovery): preserve entity and node ids in mirrors

test(trash): cover path reuse after deletion
fix(storage): allocate collision-safe manuscript paths

feat(editor): add selection-aware markdown commands
feat(editor): add configurable bold and italic shortcuts

feat(wiki): make manuscript wiki links navigable

feat(consistency): add character and timeline rules

refactor(export): introduce structured markdown renderer
fix(export): embed cover assets correctly

feat(ai): add selection and recent chapter context

refactor(rust): split command modules

ci: add frontend and rust quality gates

docs: update audit remediation status
```

---

# 21. 禁止事项

禁止：

```text
为了让测试通过删除测试
降低原有数据安全要求
删除 recovery
关闭 Rust 错误检查
大量使用 unwrap()/expect() 进入生产路径
修改旧项目格式却不提供兼容
把 API Key 写入 localStorage
默认向 AI 发送整本小说
用“TODO 已勾选”代替验收
```

---

# 22. 最终完成条件

只有同时满足以下条件，才允许将项目标记为 V1.0 候选：

```text
P1 全部完成
P2 全部完成
全部自动测试通过
大型项目测试通过
10 万字单章节验收通过
Windows release build 通过
DESKTOP_E2E_CHECKLIST 全部完成
数据库损坏恢复关联数据验证通过
六种导出格式人工打开验证通过
README/TODO/SPEC 与真实实现一致
Git 工作区干净
```

插件运行时可以继续保留为 V1.x 后续功能，但：

```text
PLUGIN_API.md
内部插件注册接口
```

至少应在 V1.0 前设计完成。

---

# 23. 执行顺序

严格优先执行：

```text
1. 数据库 UUID 灾难恢复
2. 回收站路径复用
3. CodeMirror 选区编辑 + Ctrl+B/I
4. Wiki 正文点击
5. 一致性规则
6. 导出系统
7. AI 上下文
8. commands.rs 拆分
9. CI
10. 10 万字性能测试
11. 插件 API 设计
12. Windows 桌面 E2E
13. 文档最终校准
14. V1.0 RC 构建
```

不要先进行低价值 UI 美化。

---

# 24. 工作方式

你应持续推进任务，而不是完成一个小修复后停止。

维护：

```text
AUDIT_FIX_PLAN.md
PROGRESS.md
```

作为持续开发状态。

遇到问题时：

1. 先定位原因。
2. 编写最小复现测试。
3. 修复。
4. 全量回归。
5. 记录结果。
6. 提交。
7. 继续下一项。

在没有真正阻塞的情况下不要等待人工确认。

最终给出：

```text
完成项目
剩余问题
新增测试
构建结果
大型基准结果
E2E 结果
关键 commit
是否达到 V1.0 RC 条件
```