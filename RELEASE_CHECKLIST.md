# NovelForge 发布清单

## 1.1.0-rc.1 当前发布清单

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

## 1.0.0-rc.2 当前发布清单

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
