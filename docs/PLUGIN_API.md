# NovelForge 插件 API（V1.0 设计）

## 目标与边界

V1.0 先提供进程内的 Plugin Registry，供内置功能和后续受信任的插件包共享注册协议。当前版本不从磁盘加载、编译或执行任意外部 JavaScript，也不提供动态 eval / import 入口；插件必须由应用源码显式注册。

核心接口：

~~~ts
interface NovelForgePlugin {
  id: string
  name: string
  version: string
  register(context: PluginContext): void
}
~~~

Registry 会校验插件元数据和每个扩展点的唯一 id。一个插件注册失败时，已经暂存的命令、工具、菜单、生成器、导出器和面板不会部分写入全局 Registry。

## PluginContext 扩展点

- registerCommand：注册可执行工作台命令。
- registerSidebarTool：注册侧栏工具入口。
- registerMenu：注册文件、编辑、视图、工具或帮助菜单项。
- registerGenerator：注册名字、提纲或其他内容生成器。
- registerExporter：注册导出格式及执行入口。
- registerPanel：声明一个专用工作区面板视图。

所有回调都在应用进程内运行，调用方需要自行处理错误并返回可序列化结果。扩展点 descriptor 的 id 在整个 Registry 内必须唯一，建议使用 plugin-id.feature 命名。

## 内置插件

createBuiltinPluginRegistry() 当前注册：

- builtin.name-generator：复用本地规则名字生成器，支持类别、风格和数量参数。
- builtin.consistency：复用结构化一致性检查，输入 { data: ProjectData, documents: Record<string, string> }。

内置插件与普通插件使用同一注册协议，便于后续把稳定功能迁移到独立包而不改变工作台调用方式。

## 后续版本

V1.x 可以在权限、签名和版本兼容策略确定后增加受信任插件包发现与加载。加载器必须先通过 manifest 校验、能力授权和沙箱设计，不能绕过本 API 直接执行外部脚本。
