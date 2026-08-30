import { analyzeConsistency } from './consistency-data'
import { generateNames, NAME_CATEGORIES, NAME_STYLES } from './name-generator'
import type { NameCategory, NameStyle } from './name-generator'
import type { ConsistencyReport, ProjectData } from './types'

export type PluginHandler = (input: unknown) => unknown | Promise<unknown>

export interface PluginCommand {
  id: string
  label: string
  description: string
  execute: PluginHandler
}

export interface PluginSidebarTool {
  id: string
  label: string
  icon?: string
  execute: PluginHandler
}

export interface PluginMenuItem {
  id: string
  label: string
  location: 'file' | 'edit' | 'view' | 'tools' | 'help'
  execute: PluginHandler
}

export interface PluginGenerator {
  id: string
  label: string
  description?: string
  generate: PluginHandler
}

export interface PluginExporter {
  id: string
  label: string
  formats: string[]
  execute: PluginHandler
}

export interface PluginPanel {
  id: string
  label: string
  view: string
}

export interface PluginContext {
  registerCommand(command: PluginCommand): void
  registerSidebarTool(tool: PluginSidebarTool): void
  registerMenu(item: PluginMenuItem): void
  registerGenerator(generator: PluginGenerator): void
  registerExporter(exporter: PluginExporter): void
  registerPanel(panel: PluginPanel): void
}

export interface NovelForgePlugin {
  id: string
  name: string
  version: string
  register(context: PluginContext): void
}

type Buckets = {
  commands: Map<string, PluginCommand>
  sidebarTools: Map<string, PluginSidebarTool>
  menus: Map<string, PluginMenuItem>
  generators: Map<string, PluginGenerator>
  exporters: Map<string, PluginExporter>
  panels: Map<string, PluginPanel>
}

function emptyBuckets(): Buckets {
  return {
    commands: new Map(),
    sidebarTools: new Map(),
    menus: new Map(),
    generators: new Map(),
    exporters: new Map(),
    panels: new Map(),
  }
}

function addDescriptor<T extends { id: string }>(bucket: Map<string, T>, descriptor: T, kind: string) {
  if (!descriptor.id.trim()) throw new Error(kind + ' id 不能为空')
  if (bucket.has(descriptor.id)) throw new Error(kind + ' id 已注册：' + descriptor.id)
  bucket.set(descriptor.id, descriptor)
}

function assertAvailable<T extends { id: string }>(bucket: Map<string, T>, staged: Map<string, T>, kind: string) {
  for (const descriptor of staged.values()) {
    if (bucket.has(descriptor.id)) throw new Error(kind + ' id 已注册：' + descriptor.id)
  }
}

function mergeDescriptors<T extends { id: string }>(bucket: Map<string, T>, staged: Map<string, T>) {
  for (const [id, descriptor] of staged) bucket.set(id, descriptor)
}

function inputObject(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

export class PluginRegistry {
  private readonly plugins = new Map<string, NovelForgePlugin>()
  private buckets: Buckets = emptyBuckets()

  register(plugin: NovelForgePlugin) {
    if (!plugin.id.trim() || !plugin.name.trim() || !plugin.version.trim()) {
      throw new Error('插件必须提供 id、name 和 version')
    }
    if (this.plugins.has(plugin.id)) throw new Error('插件 id 已注册：' + plugin.id)
    const staged = emptyBuckets()
    const context: PluginContext = {
      registerCommand: (command) => addDescriptor(staged.commands, command, '命令'),
      registerSidebarTool: (tool) => addDescriptor(staged.sidebarTools, tool, '侧栏工具'),
      registerMenu: (item) => addDescriptor(staged.menus, item, '菜单'),
      registerGenerator: (generator) => addDescriptor(staged.generators, generator, '生成器'),
      registerExporter: (exporter) => addDescriptor(staged.exporters, exporter, '导出器'),
      registerPanel: (panel) => addDescriptor(staged.panels, panel, '面板'),
    }
    plugin.register(context)
    assertAvailable(this.buckets.commands, staged.commands, '命令')
    assertAvailable(this.buckets.sidebarTools, staged.sidebarTools, '侧栏工具')
    assertAvailable(this.buckets.menus, staged.menus, '菜单')
    assertAvailable(this.buckets.generators, staged.generators, '生成器')
    assertAvailable(this.buckets.exporters, staged.exporters, '导出器')
    assertAvailable(this.buckets.panels, staged.panels, '面板')
    mergeDescriptors(this.buckets.commands, staged.commands)
    mergeDescriptors(this.buckets.sidebarTools, staged.sidebarTools)
    mergeDescriptors(this.buckets.menus, staged.menus)
    mergeDescriptors(this.buckets.generators, staged.generators)
    mergeDescriptors(this.buckets.exporters, staged.exporters)
    mergeDescriptors(this.buckets.panels, staged.panels)
    this.plugins.set(plugin.id, plugin)
    return this
  }

  listPlugins(): NovelForgePlugin[] {
    return [...this.plugins.values()]
  }

  commands(): PluginCommand[] {
    return [...this.buckets.commands.values()]
  }

  sidebarTools(): PluginSidebarTool[] {
    return [...this.buckets.sidebarTools.values()]
  }

  menus(): PluginMenuItem[] {
    return [...this.buckets.menus.values()]
  }

  generators(): PluginGenerator[] {
    return [...this.buckets.generators.values()]
  }

  exporters(): PluginExporter[] {
    return [...this.buckets.exporters.values()]
  }

  panels(): PluginPanel[] {
    return [...this.buckets.panels.values()]
  }
}

const nameGeneratorPlugin: NovelForgePlugin = {
  id: 'builtin.name-generator',
  name: '本地规则名字生成器',
  version: '1.0.0',
  register(context) {
    context.registerGenerator({
      id: 'builtin.name-generator.generate',
      label: '生成名字',
      description: '使用内置规则生成中文或外文名字',
      generate(input) {
        const value = inputObject(input)
        const category = (typeof value.category === 'string' ? value.category : 'character') as NameCategory
        const style = (typeof value.style === 'string' ? value.style : '中文现代') as NameStyle
        const count = Number(value.count ?? 6)
        if (!NAME_CATEGORIES.some((item) => item.id === category)) throw new Error('不支持的名字类别：' + category)
        if (!NAME_STYLES.includes(style)) throw new Error('不支持的名字风格：' + style)
        return generateNames(category, count, style)
      },
    })
  },
}

const consistencyPlugin: NovelForgePlugin = {
  id: 'builtin.consistency',
  name: '规则一致性检查',
  version: '1.0.0',
  register(context) {
    context.registerCommand({
      id: 'builtin.consistency.check',
      label: '检查项目一致性',
      description: '检查 Wiki、章节引用和资料结构冲突',
      execute(input): ConsistencyReport {
        const value = inputObject(input)
        if (!value.data || typeof value.data !== 'object') throw new Error('一致性检查需要 ProjectData')
        const documents = value.documents && typeof value.documents === 'object'
          ? value.documents as Record<string, string>
          : {}
        return analyzeConsistency(value.data as ProjectData, documents)
      },
    })
  },
}

export const BUILTIN_PLUGINS: readonly NovelForgePlugin[] = [nameGeneratorPlugin, consistencyPlugin]

export function createBuiltinPluginRegistry() {
  const registry = new PluginRegistry()
  for (const plugin of BUILTIN_PLUGINS) registry.register(plugin)
  return registry
}
