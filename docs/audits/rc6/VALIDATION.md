# rc.6 修复验收（2026-09-06）

独立审查基线为 `639c790`。对应本机独立审查的 10 项发现，阶段 1–3 分别提交为 `db62413`、`b397120`、`f582172`，阶段 4 统一版本、完整回归和发布材料。以下均为本轮 rc.6 的实际结果，历史测试不计入。

## 逐项闭环

| 发现 | 修复与证据 |
|---|---|
| 01 新建覆盖正文 | 仅允许空目录，暂存初始化完成后发布；Rust 回归覆盖已有文件、初始化失败和并发目标写入；EXE 的 `EXISTING_MANUSCRIPT_PROTECTED` 通过 |
| 02 资料草稿重置 | 内容未变实体保留引用；组件回归和 EXE 的 `ENTITY_DRAFT_PRESERVED` 通过 |
| 03 外链离开主窗口 | Markdown 外链由系统浏览器打开，原生主窗口限制导航；安全 URL/导航回归及 `MAIN_NAVIGATION_BLOCKED`、`EXTERNAL_LINK_SYSTEM_BROWSER_OK` 通过 |
| 04 侧栏压空中央 | 运行时宽度归一化，并按窗口适配；1100 px 窗口两侧偏好均 420 时实际为 310/480/310；`SIDEBAR_RESIZE_CLAMPED` 通过 |
| 05 详情裁切 | 按中央容器宽度堆叠布局；66 张截图、可见控件命中检查、滚动详情和深浅主题重点复核通过 |
| 06 复制旧稿 | 复制前保存，失败即中止；保存顺序与失败组件测试、自动保存前 EXE 复制哨兵 `UNSAVED_DOCUMENT_COPY_OK` 通过 |
| 07 长围栏导出 | 结束围栏须字符一致、长度足够且无尾随正文；Rust 5 项导出测试及 `LONG_FENCE_EXPORT_OK` 通过 |
| 08 附件上下文缺失 | 章节/小节辅助栏定位附件，AI 显式选择标题和说明；3 项附件组件/上下文测试及桌面跳转、上下文预览通过 |
| 09 筛选保留旧详情 | 详情按当前可见结果选择，空结果移除详情操作；组件测试及 `ATTACHMENT_FILTER_EMPTY_OK` 通过 |
| 10 文档版本失实 | README、SPEC、TODO、CHANGELOG、TEST_REPORT、RELEASE_CHECKLIST 和新发布说明统一 rc.6，旧版本证据标记为历史 |

## 自动化与桌面

- `pnpm typecheck`、`pnpm lint` 通过；前端 **43 文件 / 277 项**全量测试通过。
- 原始审查中三个期望正确行为的失败用例复测 **3/3** 通过（额外诊断，不重复计入上述 277 项）。
- `cargo fmt --all -- --check`、`cargo clippy --all-targets --locked -- -D warnings` 通过；Rust **100 passed / 5 ignored**。
- 两项容量用完整测试名显式执行：1000 章 / 100 万字 **11079 ms**，V1.1 辅助数据 **5961 ms**，均通过数据完整性断言。耗时只代表本机本轮；三个依赖真实 CLI 的 ignored 测试不计为通过。
- `pnpm tauri:build` 成功，EXE 与 NSIS 的 ProductVersion 均为 **1.1.0-rc.6**。
- `scripts/desktop-e2e-cdp.mjs` 完整通过，包含编辑、树操作、历史、资料、Wiki、规划、离线/测试 Provider、回收站、六种格式导出，启用封面合成素材。
- `scripts/rc6-regression-cdp.mjs` 完整通过，最终标记 `RC6_REGRESSION_DONE`。覆盖 1440×900、1366×768、1100×650 的 15 个页面及导出弹窗；另有极限拖动、重启宽度、最大双侧栏、滚动详情、双侧栏折叠与深浅主题重点场景，共 **66 张**截图。
- 几何检查在弹窗打开时仅检查弹窗内控件，排除背景遮罩的预期覆盖；非弹窗时检查工作区屏幕内控件。全部采样的工作区至少 480 px，页面无横向溢出，屏内控件中心命中检查通过。人工重点复核最小工作区附件、时间线、规划、滚动附件详情、深色时间线及导出弹窗。

原始报告、日志和截图保留在本机审查归档，不随公开源码发布。公开仓库保留本验收结论与可复验脚本：在 Windows 仓库根目录构建后运行 `node scripts/desktop-e2e-cdp.mjs` 和 `node scripts/rc6-regression-cdp.mjs`；后者使用隔离合成项目并重新生成本机截图和几何指标。

## 依赖与兼容边界

前端审计各严重性计数均为 0。Cargo 审计 exit 0，vulnerability 分类为 0，保留 **16 条 unmaintained + 1 条 glib unsound**；不宣称零警告。RustSec 快照 2026-09-02，1239 条公告，commit `5a0ebedfe8bdd2e295b171f4162f8c977bcad9a5`。glib 0.18.5 的风险来自 GTK 依赖路径，Windows x86_64-msvc 树不包含 glib；[官方公告](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)可供跨平台评估；原始 Cargo JSON 报告保留于本机归档。

只使用隔离项目与合成正文。外链实测请求本机临时 HTTP 页面，无小说内容传出。AI Provider 流程使用测试服务；附件上下文只含用户勾选的标题、说明，不解析或发送附件原文件。

当前自动发现的 Codex CLI 未通过工具隔离版本门禁，未进入真实生成。支持版本仍为 0.149.1，本轮**未重新通过真实订阅验收**，不以历史 rc.5 结果代替。详见 [接入说明](../../CODEX_INTEGRATION.md)。

本轮运行构建后的 release EXE，未重新验收安装器安装、全部原生文件选择器、WM_CLOSE 故障、所有 DPI/系统缩放、Linux/macOS、外部文档阅读器或所有模型。截图与几何采样不是所有组合的穷举，安全审计也不构成没有未知漏洞的证明。

调试过程中修正了回归脚本的弹窗选择器和复制目标定位；早期脚本失败不计为通过。执行环境一度沙箱异常/审批超时，恢复后读取日志、修正脚本并完整复跑，以上证据来自最终成功运行。

## 可追溯产物

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| novelforge.exe | 18144256 | `0296f3b42420bcdef08a5a69619d5163490e17ee63320fb1fb121b9aebc4794a` |
| NovelForge_1.1.0-rc.6_x64-setup.exe | 5288967 | `11b1d872b8ed0fffa7ae1b9ff81681d8c01e7bae163dac608b0847c9b53db7b4` |

发布使用新标签 `v1.1.0-rc.6`，保留旧标签和附件；先通过受保护 main 要求的 Frontend checks / Rust checks，再推进 main。远程提交、CI 和附件状态以 [Actions](https://github.com/Gunanzhao/NovelForge/actions) 与 [rc.6 Release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.6) 为准，发布时额外校验下载内容的 SHA-256。
