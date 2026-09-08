# AI 辅助方案 A 本地验收

日期：2026-09-08。版本：1.1.0-rc.13。源码基线：`f4695affa356e185aaeceb17b87b9c7576a9974f`，叠加本地未提交改动（包含此前 rc.12 Codex 自动兼容改造）。没有提交、推送或发布 Release。

## 实现

- 左侧集中常用任务、更多任务、写作要求和参考资料，右侧集中结果编辑；两侧独立滚动，运行和应用操作固定在底部。
- 顶部紧凑显示 AI 模式、模型、推理强度及连接状态；详细连接配置与额度移至“连接设置”。
- “使用模板”按需打开编辑器，关闭重开保留未保存草稿；沿用离开工作区时的草稿保护。
- 请求预览弹窗显示最终 System / User 内容和长度，确认后执行；内置任务结果可用当前要求重新生成。
- 保留 Provider HTTP 确认、API Key 仅驻留当前窗口、Codex 流式输出和取消、正文及选区变化保护。Escape 关闭弹窗时不清空已有结果。
- 沿用现有暖色与深色主题；小窗口下快捷任务保持横向文字，更窄工作区可上下排列。

主要实现：`src/components/AiAssistantView.tsx`、`CodexSettings.tsx`、`PromptPresetManager.tsx` 和 `src/index.css`。

## 本轮检查

| 检查 | 结果 |
| --- | --- |
| TypeScript / ESLint | 通过 |
| 前端全量测试 | 56 文件 / 324 项通过 |
| Windows Tauri Release / NSIS | 构建成功 |
| 1440×900、1100×750、1100×650 | 双栏、无整页横向溢出、固定操作栏、独立滚动通过 |
| 模板与连接弹窗 | 草稿及连接状态保留；Provider 临时字段关闭重开保留 |
| 请求与结果 | 预览后确认运行，离线结果追加到合成正文并通过自动保存写回 |
| 深色主题 | 等待主题过渡完成后截图检查通过 |
| Codex 0.153.4 | 正确版本、ChatGPT 登录、兼容通过、缓存命中及取消后禁止生成 |
| `git diff --check` | 通过 |

新增行为回归位于 `tests/ai-workbench.test.tsx`，紧凑连接状态回归位于 `tests/codex-settings.test.tsx`；其余 AI、模板及预览用例按新入口更新。首次测试的两个标签查找错误已修正，最终全量通过。桌面脚本第一次未匹配图标关闭按钮，补充无障碍名称查找后完整通过。小窗口截图发现快捷任务文字换行，修正后重新构建并复测通过。

可复现桌面命令：

```powershell
node scripts/ai-workbench-ui-cdp.mjs
node scripts/codex-compatibility-ui-cdp.mjs
```

两者都使用独立 WebView2 配置与合成项目。前者只运行离线草稿，不向 Provider 发送请求；后者读取真实 CLI 登录并运行本地兼容检查，不点击订阅生成。

本机证据（不随源码提交）：

- 最终工作台：`tmp/ai-workbench-ui-1788854302980/`，包含 `result.json`、三种尺寸、请求预览、模板草稿和深色截图，结果为 `AI_WORKBENCH_UI_PASS`。
- Codex 连接：`tmp/codex-compatibility-ui-1788853927130/`，结果为 `CODEX_COMPATIBILITY_UI_PASS`。此检查在最后一项仅涉及快捷按钮排版的 CSS 修正之前运行。

## 本地产物

- 程序：`src-tauri/target/release/novelforge.exe`
- 程序 SHA-256：`21fff1b2c5b684b086e233d124947daa32d5def21fc4ffad9ec9167442d07496`
- 安装包：`src-tauri/target/release/bundle/nsis/NovelForge_1.1.0-rc.13_x64-setup.exe`
- 安装包大小：5,508,956 bytes
- 安装包 SHA-256：`f74a931f41699c37536a28cbbd360fb722d72427e7e80895355f23a12ce3260e`
- 同目录 `SHA256SUMS-rc13.txt`、`rc13-build-manifest.json` 记录产物和本地工作区指纹。

Vite 保留原有静态／动态导入同一 store 的分包提示；Windows 链接器输出 import library 提示。构建成功，未将其描述为无警告构建。

## 验证边界

本轮没有运行真实付费 Provider 或订阅生成、安装升级、全应用桌面回归、Rust 全量测试或跨平台 GUI 验收。rc.12 的 Rust 和两版 CLI 模拟结果见历史 Codex 验收记录，不能当作本轮重跑。当前 EXE 已通过本地桌面专项，NSIS 安装包已构建但未执行安装。
