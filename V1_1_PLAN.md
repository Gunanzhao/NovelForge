# NovelForge V1.1 开发跟踪

> 当前开发候选目标：`1.1.0-rc.3`（候选源码完成、本地产物已验收，未发布）。既有已发布安装包为 `NovelForge_1.1.0-rc.2_x64-setup.exe`；当前工作区源码不等同于该安装包。版本文件已升级 rc.3。
>
> rc.1/rc.2 的测试、benchmark、CI、tag 和发布记录属于各自历史版本，不作为 rc.3 通过证据。rc.3 最终数据统一见 [测试报告](TEST_REPORT.md#rc3-validation) 与 [发布清单](RELEASE_CHECKLIST.md#rc3-checklist)；全部本地门禁已通过，源码基线 CI 已通过。

## rc.3 审计修复与验收计划

- [x] ISSUE-01：Inspector 不重复提示 Wiki；人物/地点/世界观已知 Wiki 计数、普通文本混合精确计数、未知 Wiki 与代码区排除均通过。
- [x] ISSUE-02：长 backtick/tilde fence、短 closer、混合字符、未闭合 fence、多 backtick inline code 和 Markdown helper 一致性回归通过。
- [x] 前端 frozen-lockfile 安装、typecheck、lint、34 文件 / 221 项测试及 pnpm audit 通过。
- [x] 前端 `pnpm build`（tsc + Vite）在 Tauri beforeBuild 中执行并通过，18.03 秒。
- [x] Rust check、fmt、Clippy `-D warnings` 及常规测试通过：74 passed / 2 ignored，6.78 秒；ignored 基准已另行通过。
- [x] Cargo audit 通过：exit 0，17 条 allowed warnings，与 rc.2 相同。
- [x] rc.3 两项 benchmark 通过（42.180 秒 / 22.605 秒，2 passed / 0 failed / 0 ignored）；数据完整性断言通过，无 panic/OOM/异常超时，采样及比较边界见 TEST_REPORT。
- [x] Windows `pnpm tauri build` 成功，EXE/NSIS 的 ProductVersion 均为 1.1.0-rc.3；大小及 SHA-256 见 TEST_REPORT。
- [x] CDP（WEBDRIVER=0，NATIVE=0）完整通过，含 Wiki 精确计数及原六项标记。
- [x] WebDriver（WEBDRIVER=1，NATIVE=0）完整通过，含 `WIKI_MENTION_COUNT_OK` 与原六项标记。
- [x] WebDriver + Native Dialog 完整通过（exit 0），包含原六项标记、`WIKI_MENTION_COUNT_OK` 和 `NATIVE_DIALOGS_OK`；日志 `src-tauri/target/rc3-e2e-native.log`。
- [x] CDP 已通过六个 V1.1 E2E 标记及 `WIKI_MENTION_COUNT_OK`；WebDriver 同样完整通过；Native Dialog 完整通过（exit 0）。
- [x] 源码基线 `0f1eb3f` 的 CI run `33966324453` 及 Frontend checks / Rust checks 均 completed / success。
- [x] ISSUE-05：main 分支保护已生效，必需检查为 Frontend checks / Rust checks，严格模式并约束管理员，不强制 PR，禁止强推及删除；完整配置见 RELEASE_CHECKLIST。rc.3 源码基线 CI 已通过。
- [x] 版本文件已升级 rc.3。
- [x] 版本文件与 Windows EXE/NSIS ProductVersion 均为 1.1.0-rc.3。
- [x] ISSUE-04：当前源码、本地验收与历史发布边界已同步；源码基线 CI 成功已记录。
- [x] rc.2 tag 未移动，远程与本地对象及解引用提交一致；详见 RELEASE_CHECKLIST。
- 发布边界：保留既有 rc.1/rc.2 tag 与发布资产，本次不创建 rc.3 tag/Release。

## V1.1.0-rc.2 历史基线

依据既有 [rc.2 发布说明](docs/releases/v1.1.0-rc.2.md)：前端 33 文件 / 188 项、Rust 74 项常规测试通过；两项大型 benchmark 在 rc.2 发布轮次未重跑，后续基线补验已通过（详见 TEST_REPORT）。这些结果仅适用于对应历史版本。既有安装包为 `NovelForge_1.1.0-rc.2_x64-setup.exe`；不将后续源码修复归入该安装包。

> 以下功能阶段与基线勾选来自 rc.1 开发记录；历史通过状态不关闭上述 rc.3 待办。

状态：`[ ]` 未开始，`[~]` 进行中，`[x]` 完成，`[!]` 阻塞。

目标版本：`1.1.0-rc.3`（开发候选，未发布）

## 基线（2026-09-05）

- [x] 工作区从最新 `main` 开始，基线提交为 `d571657`
- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test`：21 个测试文件、112 项测试通过
- [x] `pnpm build`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --locked`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --locked`：42 项通过、1 项大型基准按设计忽略

## 功能阶段

- [x] P1 自动资料识别
  - [x] 纯本地 Mention Scanner 与 Markdown 排除规则
  - [x] 当前章节防抖扫描和可重建全文索引
  - [x] 已知资料、别名、候选、单次/永久忽略
  - [x] 创建资料与显式“创建并插入 Wiki”
  - [x] 单元、集成和旧功能回归；桌面流程纳入最终 E2E 阶段
- [x] P2 剧情线 Story Arc
  - [x] 剧情线实体、状态、章节关联和 milestone
  - [x] 专用视图、Inspector 与一致性健康提示
  - [x] 删除、恢复、无效引用和排序测试
- [x] P3 人物出场统计
  - [x] 首次/最近登场、章节数和提及次数
  - [x] 共同出现人物、主要地点、章节跳转
  - [x] 窗口化章节人物矩阵与全文重新扫描
- [x] P4 AI Prompt Preset
  - [x] 项目级模板 CRUD、复制和重命名
  - [x] 变量解析、错误阻断和剧情线上下文
  - [x] 最终 Prompt、上下文、字符数和 Token 预览
  - [x] rewrite 结果仅允许用户显式应用
- [x] P5 灵感 Inbox
  - [x] `Ctrl+Shift+I` 快速记录
  - [x] 未整理/已整理、搜索、标签、排序、删除和恢复入口
  - [x] 转换为资料、场景、伏笔、剧情线 milestone 和笔记
  - [x] 转换失败时保留原始 Inbox 数据
- [x] P6 章节完成 Checklist
  - [x] 项目级模板与新章节继承
  - [x] 章节工作流、Inspector 进度和正文树过滤
  - [x] Dashboard 汇总与持久化

## 数据与兼容性

- [x] 旧项目无需手动转换即可打开
- [x] 正文继续保存为普通 Markdown
- [x] Story Arc、Prompt Preset、Inbox 和 Checklist 均有可恢复镜像
- [x] Mention 与人物统计可由正文和资料重新扫描生成
- [x] P1 浏览器 fallback 可运行

## rc.1 历史最终质量门禁

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test`：30 个测试文件、154 项测试
- [x] `pnpm build`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --locked`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --locked`：47 项通过、2 项显式基准按设计忽略
- [x] 1000 章 / 100 万字基准：36.48 秒
- [x] V1.1 大型数据基准：50 Story Arc、500 Inbox、100 Prompt Preset、1000 Checklist，18.71 秒
- [x] `pnpm tauri build`
- [x] release `novelforge.exe` 与 NSIS installer
- [x] CDP E2E 新旧阶段全部通过
- [x] WebDriver E2E 新旧阶段全部通过
- [x] Native Dialog E2E 新旧阶段全部通过
- [x] 最新 HEAD 的 GitHub Actions Frontend/Rust 检查成功

## rc.1 历史发布

- [x] README、SPEC、TODO、PROGRESS、DECISIONS、CHANGELOG、TEST_REPORT 与实际状态一致
- [x] 所有阶段提交仅保存在本地，开发完成后统一推送
- [x] 创建并验证 `v1.1.0-rc.1` GitHub Release

## rc.3 当前交付状态

rc.3 候选源码完成、本地产物已验收，源码基线 CI 已通过。本次范围为修复与推送，不创建 rc.3 tag 或 Release，不上传发布资产；已发布安装包仍为 `NovelForge_1.1.0-rc.2_x64-setup.exe`。

源码基线 `0f1eb3f8756a5936491f483c783387598b01a3d7`（`fix/v1.1-audit-rc3`）已推送；[CI run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) 为 `completed / success`，Frontend checks 与 Rust checks 均为 `completed / success`。全分支 push 触发已由该 run 验证。

上述 CI 只证明该源码基线。后续文档提交仍须按受保护 main 规则重新运行并通过检查，再 fast-forward 更新 main；不将源码 CI 视为尚未产生的文档提交或 main 最终提交的验证结果。

本地测试、两项基准、三种桌面 E2E、产物摘要及历史 tag 证据见 [TEST_REPORT](TEST_REPORT.md#rc3-validation) 与 [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md#rc3-checklist)。rc.2 tag 已核验未移动，main 保护规则已生效。
