# Codex 窗口连接状态验收

日期：2026-09-08。版本：1.1.0-rc.14。源码基线 `f4695affa356e185aaeceb17b87b9c7576a9974f` 加本地未提交改动，包含 rc.12 自动兼容与 rc.13 UI 改造。没有提交、推送或发布。

## 修改

`src/stores/codex-session.ts` 集中持有当前配置、状态、模型列表、诊断、登录进度及检查请求标识。`CodexSettings` 仅订阅状态，不再在卸载时清空结果或取消检查。同一窗口在检查中导航后可以继续接收进度，完成后恢复；相同配置不会重复检查。

检查成功后切换页面或切换 AI 模式再返回，恢复当前模型、推理强度与生成资格。后台完成的默认模型选择也能在重新挂载时恢复。路径或参数变化、取消检查会使旧响应失效；请求失败不会从旧状态恢复为可用。生成连接失败后，AI 页面禁用旧生成资格并提示重新检查。

状态仅存当前 WebView 内存，没有将 ready、登录状态或凭据写入持久化偏好。关闭窗口由现有后端窗口生命周期清理 CLI；新窗口重新检查，独立的七天兼容缓存仍有效。生成前现有 Rust 路径仍核验 CLI、实际配置、登录、模型和权限，导航缓存不会绕过它。外部 CLI 或配置变化在下一次检查或生成前发现，不增加定时探测。

## 验证

- TypeScript、ESLint、前端 56 文件 / 330 项通过。
- Codex 相关 21 项测试通过，覆盖页面重挂载、后台检查与默认模型恢复、模式切换、路径和参数变化、取消后迟到成功响应、失败后禁止生成，以及原有流式输出和正文／选区变化保护。
- `pnpm tauri:build` 构建成功；保留原有 Vite store 混合导入提示及 Windows 链接器 import library 输出提示。
- `node scripts/codex-compatibility-ui-cdp.mjs` 实际 rc.14 验收成功：`CODEX_COMPATIBILITY_UI_PASS`，证据在 `tmp/codex-compatibility-ui-1788855804984/`。
- 桌面检查：初次检查中离开 AI 页面再返回；成功后往返正文、总览、项目设置；切换离线后回 Codex，状态仍为已连接且允许生成。通过 CDP 非暂停条件断点观察实际 IPC 入口，整个导航流程严格只有一次 codex_status，无 codex_check_cancel。后续显式刷新命中缓存，强制验证可取消且取消后禁止生成。截图已查看。
- 初次桌面脚本导航名称错误、尝试替换不可写 IPC 方法导致计数为空，随后改为正确导航名及只观察调用的断点；一次合成项目创建遇到 Windows 拒绝访问，换新临时项目完整重跑成功。没有为通过脚本而放宽产品行为。
- `git diff --check` 通过。

## 构建

- EXE：`src-tauri/target/release/novelforge.exe`，ProductVersion `1.1.0-rc.14`，18,923,520 bytes。
- EXE SHA-256：`f65f986ed5fb816a2dd0603d7318af97669f6d64c7db76060f056956aafd6c30`。
- NSIS：`src-tauri/target/release/bundle/nsis/NovelForge_1.1.0-rc.14_x64-setup.exe`，5,508,472 bytes。
- NSIS SHA-256：`35c1c28ec9b05e08731253f0b1b637b4f5bb5e5dc11d1494001acf9aacd18f48`。
- 同目录提供 `SHA256SUMS-rc14.txt` 及 `rc14-build-manifest.json`。

本轮没有执行安装升级、真实订阅生成、付费 Provider、Rust 全量测试或全应用桌面回归。实际登录与无订阅生成的连接验收通过，不表示真实订阅生成已重跑。既有生成中的离开页面取消行为保持不变；本次延长的是连接检查和状态的生命周期。
