# Codex 订阅接入（实验性，v1.1.1-rc.1 预发布）

本功能从 v1.1.0-rc.4 起提供；先安装官方 Codex CLI，并通过 ChatGPT 登录。旧版 rc.3 Release 不包含此功能。

## 使用

1. 安装官方 Codex CLI。当前兼容基线为 **0.149.1 / 0.153.4**。新版本通过内置协议匹配及本地行为验证后自动启用；未匹配版本保留登录诊断并停止生成。程序不会自动安装、升级或降级 CLI。
2. 在 NovelForge 桌面版打开“AI 辅助”，选择“Codex 订阅（实验性）”。默认仍为离线模式；已有 HTTP 配置继续使用原模式。
3. 在顶部工具栏点击“检查连接 / 刷新登录”。自动查找原生 CLI；打开“连接设置”可查看真实路径、版本、登录、额度和兼容诊断，或重新验证。也可选择 `codex.exe` 或官方 npm 安装目录中的 `codex.cmd` / `codex.ps1`。包装脚本不会执行，程序解析其旁边的官方原生可执行文件。
4. 若未登录，点击“登录 ChatGPT”，在系统浏览器完成官方登录后刷新。本功能复用本机 CLI 登录；没有自动切换账号、退出登录或复制桌面应用令牌的功能。API Key 登录不会启用订阅生成，也不会自动切换到 API 计费。
5. 在工具栏选择动态返回的模型、推理强度，在左侧选择写作任务、要求和小说上下文。“使用模板”打开模板编辑，“预览上下文”显示最终请求；模板仍先确认最终 Prompt。关闭弹窗保留当前草稿与连接状态。
6. 结果流式显示，可停止生成；未完成文本仅供查看与复制。成功完成后才能插入或替换；原章节、正文或选区变化会阻止直接覆盖。

额度与该 Codex 账号共用；无法读取用量时显示“暂不可用”。小说内容会发送至 OpenAI，只有明确选中的内容进入请求；不要把实验功能理解为离线模型。

## 权限与兼容边界

- 通过本地子进程 stdio JSONL 通信，不开放 TCP/WebSocket 监听；原 HTTP `ai_complete` 接口及项目数据格式不变。
- 关闭 Shell、代码执行、文件工具、外部 MCP、插件、Hooks、浏览器、多代理等能力；每次生成使用空工作目录和临时会话，检查只读及禁止工具网络访问的权限回应。
- 通过进程级覆盖关闭用户 MCP，并固定使用 `https://chatgpt.com/backend-api/codex` 订阅响应路径；不会将订阅凭据用于 Platform API。自定义模型目录仅用于读取名称和推理选项，启动生成前替换为本应用创建的纯文本目录，丢弃外部指令、工具、加速计费档位和能力字段。全局配置保持不变；外部指令文件及远程运行时等未验证配置仍会阻止生成。
- 新版本须同时满足协议契约、配置隔离和本地 Responses 行为验证。校验覆盖工具声明、流式文本、完成、失败及中断；缺省 `tools` 字段与空数组均表示没有声明工具。模拟验证不代表真实订阅端到端生成已经验收。
- 额外的工具/审批请求会触发任务终止；该防线不能替代发送前的工具隔离验证。
- 提示词最多 20 万 Unicode 字符；当前界面更保守的上下文阈值仍生效。生成文本最多 2 MiB，单条协议消息最多 4 MiB，读写均使用有界队列。
- 初始化和控制请求超时 30 秒，生成等待上限 10 分钟。停止时发送中断；5 秒无响应则结束本应用拥有的进程树。初始化期间停止会直接结束尚未建立任务的连接。窗口销毁时清理本应用的连接。
- 不把 Token 存入前端偏好、项目或 NovelForge 日志。凭据存储方式仍由官方 CLI 管理；不自动重试生成。

## 开发与验证

常规检查：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`；在 `src-tauri` 内运行 `cargo fmt --all -- --check`、`cargo check --locked`、`cargo clippy --all-targets --locked -- -D warnings`、`cargo test --locked`。

Rust 协议测试使用 Node.js 假子进程，开发机及 CI 需要 Node.js 22 或更新版本。假服务不使用账号、不访问网络和用户文件。

本机 CLI 集成检查（在 `src-tauri` 中）：

```powershell
cargo test --locked installed_cli_security_and_auth_probe -- --ignored --nocapture
cargo test --locked installed_cli_sends_no_tools -- --ignored --nocapture
cargo test --locked installed_subscription_acceptance -- --ignored --nocapture
```

第一项只检查协议、有效配置和账号类型，不输出邮箱或凭据。第二项使用本地假 Provider 捕获真实 CLI 发出的生成请求，验证没有工具声明，不使用订阅额度。第三项需要真实 ChatGPT 登录并消耗少量订阅额度，验证四类写作任务、外部哨兵保护和取消。

桌面回归：设置 `NOVELFORGE_E2E_CODEX=1`，运行 `node scripts/desktop-e2e-cdp.mjs <待测EXE绝对路径>`；除既有流程外，还验证真实 CLI 的连接与未登录时的生成禁用状态。

`NOVELFORGE_E2E_CODEX_ONLY=1` 可运行快速连接诊断。额外设置 `NOVELFORGE_E2E_CODEX_LIVE=1` 时，完整桌面回归会执行一次真实订阅生成并应用到合成正文，消耗订阅额度。

真实账号验收已于 2026-09-06 使用 `gpt-5.6-luna` 完成：用合成小说进行续写、润色、分析、模板调用及中断测试，并发送要求访问外部哨兵文件、执行命令和修改文件的对抗提示，确认无访问或执行。其他模型和后续 CLI 版本需要单独验证，不能据此宣称全部型号都已实测。

官方依据：[App Server](https://learn.chatgpt.com/docs/app-server)、[Authentication](https://learn.chatgpt.com/docs/auth)。

## rc.12 自动兼容流程

“检查连接 / 刷新登录”依次识别真实 CLI 版本与 SHA-256、读取登录、模型和额度、核对配置、匹配稳定协议、运行本地模拟检查。首次未指定模型时采用 CLI 推荐模型；保存的模型失效时必须重新选择，不自动替换。切换模型或推理强度后重新判断兼容性。

连接、登录和生成资格分别显示。检查失败仍保留已确认的版本、路径和登录信息；额度查询缺失不会阻止生成。新额度桶优先使用 `rateLimitsByLimitId`，兼容旧 `rateLimits`；未返回的额度不显示为零。诊断包含阶段、错误代码和是否可重试，仅保留受控错误类别，不保存原始 CLI 错误文本、令牌、配置或正文。

本地验证使用应用创建的独立配置目录和空工作目录、无账号凭据的随机回环端口及一次性路径标识。仅发送合成内容，不访问真实生成服务。实际生成仍固定使用官方订阅路径并重新核对生效配置与会话权限。新版本匹配现有适配方案才会被接受；不下载执行远程适配代码。协议定义来自对应 CLI 的 `app-server generate-json-schema`；仅已验收的 0.149.1 在无法导出时允许使用内置契约并继续行为验证。

检查最长 90 秒，可以取消。成功缓存有效期七天，绑定 CLI 文件指纹、适配器及验证器版本、所选文本模型配置、推理强度和配置指纹。文件替换、配置变化、过期或损坏会触发重新验证；“重新验证”会主动跳过并移除该项旧缓存。只有只读查询的超时允许重试一次，生成不自动重发。

Windows CI 工作流 `codex-compatibility.yml` 固定检查 0.149.1 和 0.153.4，可手动传入额外精确版本。CLI 安装仅发生在 CI 临时目录，不修改最终用户的 CLI；没有定时任务。

无订阅消耗的新增检查：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked installed_cli_compatibility_probe -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked installed_runtime_cache_probe -- --ignored --nocapture
node scripts/codex-compatibility-ui-cdp.mjs
```

第一个检查可用 `NOVELFORGE_TEST_CODEX` 指定已准备好的测试二进制；第二个检查读取真实 CLI 登录类型并验证本地模拟服务和缓存，不调用真实生成。桌面脚本使用独立合成项目及 WebView2 配置，校验连接界面且不点击生成。

官方协议说明：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。当前本地验收见 [rc.12 Codex 兼容记录](audits/codex-compatibility-2026-09-08.md)。


## rc.14 窗口内连接状态

完成一次连接检查后，切换到正文、总览等页面再返回，或切换 AI 模式再回 Codex，相同配置会保留模型、推理强度、登录与兼容诊断以及生成资格，不会因页面重建重复发起检查。检查中离开页面会继续执行，回来接续进度或结果；可以显式取消。

该状态只存在当前 WebView 内存中，不保存账号凭据、不写入项目，也不会将 ready 永久保存到偏好。关闭软件窗口后内存状态销毁，重新打开仍需检查；原有七天兼容性缓存独立保留。

路径、模型或推理参数变化会使旧资格失效；CLI 文件、外部配置或登录变化仍由生成前的后端核验发现，缓存命中不能跳过实际环境校验。生成连接失败后界面禁用旧资格并提示重新检查。这里保持的是已确认的连接状态，不承诺同一个子进程永远存活，也不增加定时付费请求或自动重发生成。
