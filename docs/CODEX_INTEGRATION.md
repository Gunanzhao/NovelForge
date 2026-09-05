# Codex 订阅接入（实验性，v1.1.0-rc.4）

本功能从 v1.1.0-rc.4 起提供；先安装官方 Codex CLI，并通过 ChatGPT 登录。旧版 rc.3 Release 不包含此功能。

## 使用

1. 安装官方 Codex CLI。首个经过协议与无工具请求验证的版本为 **0.149.1**；当前对其他版本关闭生成入口，升级支持必须先重跑工具目录验证。
2. 在 NovelForge 桌面版打开“AI 辅助”，选择“Codex 订阅（实验性）”。默认仍为离线模式；已有 HTTP 配置继续使用原模式。
3. 点击“检查连接 / 刷新登录”。自动查找原生 CLI，也可选择 `codex.exe` 或官方 npm 安装目录中的 `codex.cmd` / `codex.ps1`。包装脚本不会执行，程序解析其旁边的官方原生可执行文件。
4. 若未登录，点击“登录 ChatGPT”，在系统浏览器完成官方登录后刷新。本功能复用本机 CLI 登录；没有自动切换账号、退出登录或复制桌面应用令牌的功能。API Key 登录不会启用订阅生成，也不会自动切换到 API 计费。
5. 选择动态返回的模型、推理强度和小说上下文。可以运行原有写作动作及提示词模板；模板仍先确认最终 Prompt。
6. 结果流式显示，可停止生成；未完成文本仅供查看与复制。成功完成后才能插入或替换；原章节、正文或选区变化会阻止直接覆盖。

额度与该 Codex 账号共用；无法读取用量时显示“暂不可用”。小说内容会发送至 OpenAI，只有明确选中的内容进入请求；不要把实验功能理解为离线模型。

## 权限与兼容边界

- 通过本地子进程 stdio JSONL 通信，不开放 TCP/WebSocket 监听；原 HTTP `ai_complete` 接口及项目数据格式不变。
- 关闭 Shell、代码执行、文件工具、外部 MCP、插件、Hooks、浏览器、多代理等能力；每次生成使用空工作目录和临时会话，检查只读及禁止工具网络访问的权限回应。
- 通过进程级覆盖关闭用户 MCP，并固定使用 `https://chatgpt.com/backend-api/codex` 订阅响应路径；不会将订阅凭据用于 Platform API。自定义模型目录仅用于读取名称和推理选项，启动生成前替换为本应用创建的纯文本目录，丢弃外部指令、工具、加速计费档位和能力字段。全局配置保持不变；外部指令文件及远程运行时等未验证配置仍会阻止生成。
- 未知版本不只根据相似协议就放行。必须验证实际 Responses 请求未声明任何工具；缺省 `tools` 字段与空数组均表示没有声明工具。
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
