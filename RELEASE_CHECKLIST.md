# NovelForge 发布清单

## 1.1.1-rc.1

- 统一 package.json、Tauri 配置、Cargo.toml、Cargo.lock 和产物版本；保留历史审计记录原版本。
- 更新 README 下载入口、CHANGELOG 与独立发布说明。
- 工作分支通过 Frontend checks / Rust checks 后快进 main，保持现有分支保护，不强推。
- 发布独立 v1.1.1-rc.1 预发布，上传 Windows 安装包、独立 EXE 和 SHA256SUMS.txt，核对远端附件摘要及标签指向。

以下为历史记录；其中“未推送／未发布”描述各次本地交付当时的边界。


## 1.1.0-rc.14 本地交付

- [x] 窗口级 Codex 连接状态、检查任务、取消及配置失效处理完成。
- [x] 前端 330 项、类型检查、Lint 通过，实际 EXE 页面切换与无重复检查验收通过。
- [x] Windows EXE / NSIS 版本统一为 rc.14，记录源码基线与产物 SHA-256。
- 本轮不提交、推送或发布，不执行真实订阅生成或安装升级。详见 [验收记录](docs/audits/codex-session-2026-09-08.md)。


## 1.1.0-rc.13 本地交付

- [x] AI 辅助方案 A 双栏布局、按需配置和模板弹窗完成。
- [x] 前端 324 项、类型和 Lint 通过；桌面布局、离线写回及 Codex 连接专项通过。
- [x] Windows EXE / NSIS 版本统一为 rc.13，产物校验记录见 [验收记录](docs/audits/ai-workbench-2026-09-08.md)。
- 本轮仅本地交付，不提交、推送或发布 Release；安装升级与真实订阅生成未重跑。

## 1.1.0-rc.11

- 本地改动分阶段验证并提交；全量桌面、可靠性专项及双尺寸 UI 回归通过。
- Windows EXE / NSIS 版本统一为 rc.11；rc.10 安装升级和旧项目数据保留已验证。
- README、CHANGELOG、TODO、测试报告和发布说明区分当前结果与历史记录。
- 完成本地门禁后统一推送工作分支，等待 Frontend checks / Rust checks 后快进受保护 main；不修改保护规则。
- 发布独立 v1.1.0-rc.11 预发布，上传安装包与 SHA256SUMS.txt，核对远端附件和代码。实时状态以 GitHub 为准。

以下为历史发布清单。

## 1.1.0-rc.6

- [x] 独立审查 10 项问题已实现修复并有对应证据；阶段 1–3 已分别本地提交。
- [x] package.json、Cargo.toml、Cargo.lock、Tauri 配置及 EXE/NSIS 统一为 rc.6。
- [x] 前端 277 项、Rust 100 项、原始失败用例 3 项、容量 2 项通过；类型、Lint、格式、Clippy 通过。
- [x] 完整桌面回归、新增问题回归及 66 张布局截图通过；产物哈希记录于 [验收记录](docs/audits/rc6/VALIDATION.md)。
- [x] README、SPEC、TODO、CHANGELOG、测试报告与 [rc.6 发布说明](docs/releases/v1.1.0-rc.6.md) 同步，明确真实订阅及原生验收边界。
- 发布顺序：完成全部本地修复与阶段 4 提交后统一推送工作分支，等待 Frontend checks / Rust checks 成功，再快进受保护 main；保持保护规则和历史标签不变。
- 创建独立 `v1.1.0-rc.6` 标签，上传安装包与 SHA256SUMS.txt 到草稿；校验远程附件内容后公开预发布。实时结果以 [CI](https://github.com/Gunanzhao/NovelForge/actions) 和 [Release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.6) 为准。

以下为历史发布记录。

## 1.1.0-rc.4

- 代码、版本、锁文件与安装包统一为 1.1.0-rc.4。
- 发布前执行前端/Rust 门禁、真实 CLI 与安装后桌面验收，证据见 [测试报告](TEST_REPORT.md#rc4-validation)。
- 工作分支通过必需 CI 后再快进 main，保持分支保护，创建独立 rc.4 标签并校验 Release 附件。
- [rc.4 发布说明](docs/releases/v1.1.0-rc.4.md)。以下为 rc.3 历史清单。

> 历史版本：`1.1.0-rc.3`（预发布候选版）。Windows x64 安装包为 `NovelForge_1.1.0-rc.3_x64-setup.exe`；下载、发布状态及 SHA-256 校验文件见 [GitHub Release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.3)。
>
> rc.1/rc.2 的测试、benchmark、CI、tag 和发布记录属于各自历史版本，不作为 rc.3 通过证据。rc.3 最终数据统一见 [测试报告](TEST_REPORT.md#rc3-validation) 与 [发布清单](RELEASE_CHECKLIST.md#rc3-checklist)；全部本地门禁已通过，源码基线 CI 已通过。

<a id="rc3-checklist"></a>

## 1.1.0-rc.3 发布验收清单

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
- 发布边界：保留既有 rc.1/rc.2 tag 与发布资产，rc.3 以新的 tag/Release 发布。
- 发布附件：Windows x64 安装包与 SHA256SUMS.txt；先在草稿中校验完整性，再公开预发布。

## V1.1.0-rc.2 历史基线

依据既有 [rc.2 发布说明](docs/releases/v1.1.0-rc.2.md)：前端 33 文件 / 188 项、Rust 74 项常规测试通过；两项大型 benchmark 在 rc.2 发布轮次未重跑，后续基线补验已通过（详见 TEST_REPORT）。这些结果仅适用于对应历史版本。既有安装包为 `NovelForge_1.1.0-rc.2_x64-setup.exe`；不将后续源码修复归入该安装包。

> 以下勾选为历史版本的发布证据，不属于 rc.3 发布前清单。

## 1.1.0-rc.1 历史发布清单

- [x] `package.json`、`Cargo.toml`、`Cargo.lock` 和 `tauri.conf.json` 统一为 `1.1.0-rc.1`。
- [x] P1–P6 功能、兼容格式、可恢复 Markdown 镜像和浏览器 fallback 均完成。
- [x] `pnpm install --frozen-lockfile`、typecheck、lint、30 文件 / 154 项前端测试和 build 通过。
- [x] `cargo check --locked`、47 项常规 Rust 测试通过；`cargo-audit 0.22.2` 无阻断性漏洞。
- [x] 1000 章 / 100 万字基准 36.48 秒；V1.1 辅助数据基准 18.71 秒。
- [x] `pnpm tauri build` 生成 `novelforge.exe` 和 `NovelForge_1.1.0-rc.1_x64-setup.exe`。
- [x] release CDP、Tauri WebDriver、WebDriver + Native Dialog 全部新旧阶段标记通过。
- [x] 最新 `main` HEAD 的 GitHub Actions Frontend/Rust 检查成功。
- [x] GitHub [v1.1.0-rc.1 Pre-release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0-rc.1) 已创建并附加 NSIS 安装包。
- [x] NSIS：5,154,783 bytes，SHA-256 `E0E80D72E50E6484FEE1A9C9C0608291C4B83DAA3AEB7751A84064B871C11DB5`。

## 1.0.0-rc.2 历史发布清单

- [x] 版本文件已升级为 `1.0.0-rc.2`；已公开 `v1.0.0-rc.1` 保持不变。
- [x] FIX-01 ReactMarkdown 脚注预览、中文无障碍标签、引用/返回锚点及组件级测试通过。
- [x] FIX-02 完整 ASCII 可见字符全角/半角转换、Markdown 安全保护和可逆性测试通过。
- [x] FIX-03 rc.2 release CDP 与官方 WebDriver + Native Dialog 全阶段通过，含 `NATIVE_DIALOGS_OK`。
- [x] 前端 17 文件 / 75 项测试、Rust 常规测试 35 项、1000 章 / 100 万字基准（50.90 秒）和 `pnpm.cmd tauri:build` 通过。
- [x] rc.2 产物：`src-tauri/target/release/novelforge.exe`、`src-tauri/target/release/bundle/nsis/NovelForge_1.0.0-rc.2_x64-setup.exe`。
- [x] 推送 rc.2 代码/tag、确认最新 HEAD CI、创建 GitHub Pre-release 并上传 NSIS：`main`=`5aac219`，`v1.0.0-rc.2`=`961ad26`，run #11（`33712235453`）success；[Pre-release](https://github.com/Gunanzhao/NovelForge/releases/tag/v1.0.0-rc.2) 已发布。
- [x] NSIS 资产已核验：`NovelForge_1.0.0-rc.2_x64-setup.exe`，5,127,968 bytes，SHA-256 `C760969ECC72DEA0A7B6FFC5026C49B72597C68972FA41AAC9697412FA2ABD1A`。

## 1.0.0-rc.1 历史记录

## 版本与产物

- [x] `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `Cargo.lock` 统一为 `1.0.0-rc.1`。
- [x] `CHANGELOG.md` 已记录脚注、字符全角/半角转换、右键菜单验收和 Rust 模块化。
- [x] Windows release EXE：`src-tauri/target/release/novelforge.exe`。
- [x] Windows NSIS：`src-tauri/target/release/bundle/nsis/NovelForge_1.0.0-rc.1_x64-setup.exe`。

## 本地门禁

- [x] `pnpm.cmd install --frozen-lockfile`
- [x] `pnpm.cmd typecheck`
- [x] `pnpm.cmd lint`
- [x] `pnpm.cmd test -- --run`（16 个测试文件 / 72 个测试）
- [x] `pnpm.cmd build`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`（35 通过 / 1 ignored）
- [x] `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture`（1000 章/100 万字，58.76 秒）
- [x] `pnpm.cmd tauri:build`

## 桌面与远程

- [x] 当前 release 直连 CDP E2E：旧阶段及 `CONTEXT_MENU_OK`、`PLANNING_CONTEXT_MENU_OK`、`EXPORTS_OK` 全部通过。
- [x] 当前 release 官方 Tauri WebDriver WebView2（不启用原生文件对话框）：旧阶段及 `CONTEXT_MENU_OK`、`PLANNING_CONTEXT_MENU_OK`、`EXPORTS_OK` 全部通过。
- [~] 官方 WebDriver + Native Dialog：附件选择器在本机出现焦点/列表刷新竞态，待稳定桌面焦点环境复跑。
- [x] 发布候选代码 GitHub Actions Frontend checks / Rust checks：提交 `40ae175` 已推送，run `33699593424` 两个 job 均 success；随后发布记录提交 `1751dfd` 的 run `33705658724` 也均 success。
- [x] 创建并推送 `v1.0.0-rc.1`：已按发布确认创建并推送，指向发布候选代码提交 `40ae175`。

## 仓库维护建议

- [ ] 在 GitHub `main` 分支启用 required checks：`Frontend checks`、`Rust checks`。
- [ ] 发布后确认分支保护规则已生效；当前 RC tag 已指向通过 CI 的提交，分支保护仍属于仓库维护建议。

## rc.3 最终验证证据与交付边界

源码基线 `0f1eb3f8756a5936491f483c783387598b01a3d7`（`fix/v1.1-audit-rc3`）已推送；[CI run 33966324453](https://github.com/Gunanzhao/NovelForge/actions/runs/33966324453) 为 `completed / success`，Frontend checks 与 Rust checks 均为 `completed / success`。全分支 push 触发已由该 run 验证。

该记录对应功能源码基线；验收文档提交 `f2e2d67` 的 [main CI 33967007863](https://github.com/Gunanzhao/NovelForge/actions/runs/33967007863) 也已通过。发布文档在工作分支通过必需检查后合入 main；最新状态见 [main 工作流](https://github.com/Gunanzhao/NovelForge/actions/workflows/ci.yml?query=branch%3Amain)。

### 历史基线与 tag 保留

`v1.1.0-rc.2` 未移动：远程与本地 tag 对象均为 `c4ac0ddd4c30a923ee9323de7ca1858c803817f5`，解引用仍为 `90a64257afd994eb3c541787c5350fb44d609494`。

rc.2 基线 `90a6425` 的 CI run `33947878811` 成功。rc.2 发布时未重跑大型 benchmark；后续补验通过，分别为 38.506 秒 / 20.076 秒（`38506` / `20076` ms），顺序单线程总耗时 58.96 秒，0 失败、0 忽略，无 panic/OOM 退出，未连续采样峰值内存。相较 rc.1 的 36.48 / 18.71 秒约 +5.55% / +7.30%。这些历史证据不替代 rc.3 实测，也不改写原发布说明。

### rc.3 本地门禁与基准

- 前端安装、typecheck、lint、审计通过；34 文件 / 221 项全部通过，20:19:20 开始，25.20 秒；pnpm audit 无已知漏洞。
- Rust check/fmt/Clippy `-D warnings` 通过；常规测试 74 passed / 2 ignored，6.78 秒；Cargo audit exit 0，17 条 allowed warnings，与 rc.2 相同。
- 两项 ignored benchmark 单独通过：`LARGE_PROJECT_BENCHMARK_MS=42180`、`V1.1_AUXILIARY_BENCHMARK_MS=22605`，即 42.180 / 22.605 秒；2 passed / 0 failed / 0 ignored，执行 65.20 秒，不含编译 43.11 秒。
- 每 250 ms 采样，共 248 次；合并两项测试进程 `sampledPeakWorkingSetBytes=31264768`（约 29.8 MiB）、`sampledPeakPrivateBytes=9777152`（约 9.32 MiB）。采样观测非绝对上限，不含编译进程；无 panic/OOM/异常超时，数据完整性断言通过。
- 相较 rc.1 约 +15.6% / +20.8%，均小于 30%；包含采样且主机负载不同，rc.2 基准版本至 rc.3 无 Rust 业务改动，不据此严格归因为代码回退。日志 `src-tauri/target/rc3-benchmark.*.log` 位于被忽略的本地构建目录。

### Windows 发布产物

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

rc.3 候选源码、本地产物及三种桌面回归均已验收。发布版本为 `v1.1.0-rc.3`，附件包括 `NovelForge_1.1.0-rc.3_x64-setup.exe` 与 `SHA256SUMS.txt`；安装包 SHA-256 为 `cf5b38c3aee63e53f0791a1329cc75d072c623d43eb4d1e27d4e10228c70a92f`。既有 rc.1/rc.2 标签和历史发布资产保留。


## v1.1.0-rc.10（2026-09-07）

301 项前端、100 项 Rust 测试及 rc.10 桌面专项通过；安装包、校验值和完整验证边界见 [rc.10 验收记录](docs/audits/rc10-validation.md)。

<a id="rc12-checklist"></a>

## rc.12 Codex 自动兼容（本地，2026-09-08）

前端 319 项、Rust 115 项常规测试，以及类型、Lint、格式、Clippy、两版 CLI 本地模拟、真实环境登录与缓存、桌面连接界面和 Windows 构建通过。未运行真实订阅生成、安装升级或云端工作流，未发布。详见 [rc.12 验收记录](docs/audits/codex-compatibility-2026-09-08.md)。
