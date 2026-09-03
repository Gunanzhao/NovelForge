# NovelForge 1.0.0 RC 发布清单

## 1.0.0-rc.2 当前发布清单

- [x] 版本文件已升级为 `1.0.0-rc.2`；已公开 `v1.0.0-rc.1` 保持不变。
- [x] FIX-01 ReactMarkdown 脚注预览、中文无障碍标签、引用/返回锚点及组件级测试通过。
- [x] FIX-02 完整 ASCII 可见字符全角/半角转换、Markdown 安全保护和可逆性测试通过。
- [x] FIX-03 rc.2 release CDP 与官方 WebDriver + Native Dialog 全阶段通过，含 `NATIVE_DIALOGS_OK`。
- [x] 前端 17 文件 / 75 项测试、Rust 常规测试 35 项、1000 章 / 100 万字基准（50.90 秒）和 `pnpm.cmd tauri:build` 通过。
- [x] rc.2 产物：`src-tauri/target/release/novelforge.exe`、`src-tauri/target/release/bundle/nsis/NovelForge_1.0.0-rc.2_x64-setup.exe`。
- [ ] 推送 rc.2 代码/tag、确认最新 HEAD CI、创建 GitHub Pre-release 并上传 NSIS：待本轮远程发布授权。

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
