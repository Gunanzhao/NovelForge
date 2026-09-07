# v1.1.0-rc.10 发布验收（2026-09-07）

## 本机门禁

- pnpm install --frozen-lockfile、pnpm typecheck、pnpm lint：通过。
- pnpm test：49 文件、301 项测试通过。
- pnpm audit --audit-level high：无已知漏洞。
- cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check：通过。
- cargo test --manifest-path src-tauri/Cargo.toml --locked：100 通过、5 项显式集成/容量测试忽略。
- pnpm tauri:build：rc.10 Windows release EXE 与 NSIS 安装包构建成功。

## 桌面验证

均在 rc.10 release EXE 上使用合成项目和隔离 WebView2 配置执行：

- scripts/workspace-ui-cdp.mjs：WORKSPACE_UI_PASS；13 个工作区、1440×900 / 1100×750、深色模式、资料草稿、设置预览与实际 TXT 导出。
- scripts/inbox-ui-cdp.mjs：INBOX_UI_PASS；空状态、新建记录、列表/正文独立滚动、筛选清理、窄屏返回、转为伏笔及深色模式。
- scripts/settings-ui-cdp.mjs：SETTINGS_UI_PASS；五类设置、跨分类草稿、保存、精确输入预览、重置、按需日志，1920/1440/1100 宽度。
- 一次性桌面探针：DEFAULT_EDIT_AND_REOPEN_PASS、SIDEBAR_ANIMATIONS_AND_BUTTON_ORDER_PASS、ENTITY_SAVE_SPACING_PASS、NAME_ORDER_AND_THEME_PASS。分别验证默认编辑模式、双向侧栏动画与减少动态效果、三类资料保存区留白、名字生成器位置与浅/深主题复选框颜色。

本地截图与几何记录：tmp/workspace-ui-1788796066814、tmp/inbox-ui-1788796080956、tmp/settings-ui-1788796084988。合成项目和截图未作为产品数据提交。

## 产物

- NovelForge_1.1.0-rc.10_x64-setup.exe
- SHA-256：9909130efa95b66421d9cbeea55df38b89c850a797f197df16b8949d92e5d7d9
- SHA256SUMS.txt 与安装包一同附在 GitHub Release。

## 验证边界

早前 rc.9 完整桌面脚本在“正文树多选右键菜单”检查失败，本次未将其标记为修复或全流程通过。未重新验收安装器安装、跨平台 GUI、大型容量和真实付费 AI/Codex 服务。云端 Frontend checks / Rust checks 必须通过后才更新受保护 main 与发布标签；以 GitHub 对应提交的检查记录为准。