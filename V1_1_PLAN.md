# NovelForge V1.1 开发跟踪

状态：`[ ]` 未开始，`[~]` 进行中，`[x]` 完成，`[!]` 阻塞。

目标版本：`1.1.0-rc.1`

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
- [~] P5 灵感 Inbox
  - [ ] `Ctrl+Shift+I` 快速记录
  - [ ] 未整理/已整理、搜索、标签、排序、删除和恢复
  - [ ] 转换为资料、场景、伏笔、剧情线 milestone 和笔记
  - [ ] 转换失败时保留原始 Inbox 数据
- [ ] P6 章节完成 Checklist
  - [ ] 项目级模板与新章节继承
  - [ ] 章节工作流、Inspector 进度和正文树过滤
  - [ ] Dashboard 汇总与持久化

## 数据与兼容性

- [ ] 旧项目无需手动转换即可打开
- [ ] 正文继续保存为普通 Markdown
- [~] Story Arc、Prompt Preset 已有可恢复镜像；Inbox 和 Checklist 待实现
- [x] Mention 与人物统计可由正文和资料重新扫描生成
- [x] P1 浏览器 fallback 可运行

## 最终质量门禁

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml --locked`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --locked`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --locked -- --ignored --nocapture`
- [ ] V1.1 大型数据基准：50 Story Arc、500 Inbox、100 Prompt Preset、1000 Checklist
- [ ] `pnpm tauri build`
- [ ] release `novelforge.exe` 与 NSIS installer
- [ ] CDP E2E 新旧阶段全部通过
- [ ] WebDriver E2E 新旧阶段全部通过
- [ ] Native Dialog E2E 新旧阶段全部通过
- [ ] 最新 HEAD 的 GitHub Actions Frontend/Rust 检查成功

## 发布

- [ ] README、SPEC、TODO、PROGRESS、DECISIONS、CHANGELOG、TEST_REPORT 与实际状态一致
- [ ] 所有阶段提交仅保存在本地，开发完成后统一推送
- [ ] 创建并验证 `v1.1.0-rc.1` GitHub Release
