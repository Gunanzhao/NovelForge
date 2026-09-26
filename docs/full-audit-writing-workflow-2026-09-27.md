# 六项写作流程交付后的全仓审查

首次统一推送：`codex/writing-workflow-20260927`，提交 `2d5f49d2196d0f05b2467cf664f4c6a57e58a1c8`。完成后统一第二次推送；本记录不是最终通过声明。

## 问题与进度

- WF-A01：CRLF原稿的AI选区取字使用CodeMirror LF坐标，可能包含错误的前后文字。已增加原文位置映射与过期选区拒绝，13项AI任务回归及typecheck/lint通过；CRLF与LF生产桌面选区预览、请求范围专项均已通过。
- WF-A02：AI编辑器写入器要求原始正文与CodeMirror LF正文完全相等，CRLF原稿上会拒绝应用。已将原文变化映射到CodeMirror换行坐标，纯换行归一不作为语义冲突；14项AI任务回归、typecheck/lint通过。生产桌面CRLF和LF两种专项通过：逐项接受、撤销/重做、保留原文、窄窗操作栏及保存；CRLF保护历史与操作前原稿逐字符相同。证据：tmp/editor-ai-ui-crlf-1790442734635/result.json、tmp/editor-ai-ui-1790442740116/result.json。

- WF-A03：首次推送Rust CI因RUSTSEC-2026-0285失败，锁定依赖rustls从0.23.43升级至0.23.45；159项Rust回归通过（7项跳过）。本机未安装cargo-audit，完整审计须由下一次云端CI复验，不绕过审计门禁。

## 本地全量审查结论与待交付项

WF-A01～WF-A05均已修复并逐项提交。已完成源码交叉检查、完整前端/Rust回归、主要页面长文本视觉矩阵及生产桌面专项；不能将本地通过当作云端CI或发布已完成。

- 475项前端测试（77个文件）、159项Rust测试通过（7项按原设置跳过）；typecheck/lint/rustfmt/Clippy通过。
- pnpm audit --audit-level high：未发现已知漏洞；Rust完整依赖审计仍待第二次推送CI。
- Windows生产EXE已重建；完整desktop-e2e-cdp通过，覆盖正文与树操作、历史、资料、Wiki、规划、搜索、AI取消、回收站及六种导出。测试原有裁剪诊断不影响对应断言完成。
- 六项writing-workflow生产专项通过，证据tmp/workflow-acceptance/evidence.json，本次run为tmp/workflow-1790443342054。
- CRLF AI桌面专项通过：tmp/editor-ai-ui-crlf-1790443348920/result.json。
- Provider请求取消及连接释放通过，合成服务未使用真实生成额度：tmp/provider-lifecycle-1790443354381/result.json。
- 旧写入IPC拒绝、编辑会话、远程图片授权、关闭/导航草稿保护、外部冲突恢复、备份恢复、撤销及版本UI专项通过：tmp/reliability-ui-1790443358177/result.json。
- 设置桌面专项通过：tmp/settings-ui-1790443365892/metrics.json。
- 待完成：第二次统一推送、CI安全审计及主分支同步；README、版本号、Release说明、安装包/独立EXE/校验文件与云端版本一致性。

- WF-A04：批注前方插入CRLF段落时，变化集默认归一换行导致位移少算。明确按原文LF分隔构建变化集、保留CR字符，覆盖初始定位与持久化锚点重映射；7项批注回归、typecheck/lint通过。

- WF-A05：CRLF正文发生编辑后再次编辑AI结果，冲突路径将归一后的选区文字套用原始坐标。保存不可变原选区结束位置，从初始正文重建对比，再映射到当前正文；15项AI任务回归、typecheck/lint通过，包含保留用户改动并接受另一无冲突建议。

## 扩展审查证据

- 生产桌面21个主页面×1100/1440/1920×浅深主题共126组通过，人物/地点/世界观、时间线、剧情线、灵感、章节记忆和批注使用已填长文本，包含连续英文及长标签。检查正文/标题/控件不越过主工作区、无窗口横向溢出、共用资料容器不超过760px且相对其父级居中。证据：tmp/workspace-ui-matrix-1790443046777/metrics.json及截图；已人工查看人物窄窗深色、批注窄窗浅色、记忆宽窗深色截图。稿件导入本矩阵为空态，已填导入由六项专项覆盖。
- 生产备份专项：缺失历史/回收站正文拒绝备份、完整备份校验及恢复后可读取；DOCX编号关系完整，EPUB仅一张封面。证据：tmp/full-audit-acceptance/backend-evidence.json与export-evidence.json（本次run为tmp/full-audit-1790442916696）。

- WF-A06：人工截图发现附件计数窄窗挤成竖排，剧情线标题重复缩进且宽屏未跟随表单居中。计数保持单行且不收缩，剧情线标题与表单共用原有920px宽度规则。加入实际文字行数和标题左缘断言，126组生产桌面布局复验通过，并查看修复后附件窄窗/剧情线宽窗截图；证据tmp/workspace-ui-matrix-1790443957555/metrics.json。附件说明已补入长文本；lint及生产构建通过。

第二次统一推送已通过API逐对象核验原始Git哈希并快进至8d6a2c1。该提交云端CI 36259059328全部通过，包含Rust安全审计；CLI兼容性任务36259059393仍待完成。WF-A06在人工复核中随后发现，按相同规则另行提交并纳入最终发布验证。
