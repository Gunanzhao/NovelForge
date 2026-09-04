import { describe, expect, it } from 'vitest'
import { createBuiltinPluginRegistry, PluginRegistry, type NovelForgePlugin } from '../src/lib/plugin-registry'
import type { ContextMenuPayload } from '../src/lib/context-menu'

describe('plugin registry', () => {
  it('registers the built-in name generator and consistency command', async () => {
    const registry = createBuiltinPluginRegistry()
    expect(registry.listPlugins().map((plugin) => plugin.id)).toEqual([
      'builtin.name-generator',
      'builtin.consistency',
    ])
    const names = await registry.generators()[0].generate({ category: 'character', style: '中文现代', count: 3 })
    if (!Array.isArray(names) || !names.every((name): name is string => typeof name === 'string')) {
      throw new Error('名字生成器应返回字符串数组')
    }
    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => !/[A-Za-z]/u.test(name))).toBe(true)
    expect(registry.commands().map((command) => command.id)).toContain('builtin.consistency.check')
    expect(registry.contextMenus('workspace', { location: 'workspace' }).map((item) => item.id)).toContain('builtin.consistency.context')
  })

  it('exposes every extension point and rejects duplicate descriptors atomically', () => {
    const registry = new PluginRegistry()
    const plugin: NovelForgePlugin = {
      id: 'test.all-points',
      name: 'Test plugin',
      version: '0.1.0',
      register(context) {
        context.registerCommand({ id: 'test.command', label: '命令', description: '命令', execute: () => null })
        context.registerSidebarTool({ id: 'test.tool', label: '工具', execute: () => null })
        context.registerMenu({ id: 'test.menu', label: '菜单', location: 'tools', execute: () => null })
        context.registerGenerator({ id: 'test.generator', label: '生成器', generate: () => [] })
        context.registerExporter({ id: 'test.exporter', label: '导出器', formats: ['txt'], execute: () => null })
        context.registerPanel({ id: 'test.panel', label: '面板', view: 'test' })
      },
    }
    registry.register(plugin)
    expect(registry.sidebarTools()).toHaveLength(1)
    expect(registry.menus()).toHaveLength(1)
    expect(registry.generators()).toHaveLength(1)
    expect(registry.exporters()).toHaveLength(1)
    expect(registry.panels()).toHaveLength(1)

    const duplicateDescriptor: NovelForgePlugin = {
      id: 'test.duplicate-descriptor',
      name: 'Duplicate descriptor',
      version: '0.1.0',
      register(context) {
        context.registerCommand({ id: 'test.new-command', label: '未提交', description: '未提交', execute: () => null })
        context.registerCommand({ id: 'test.command', label: '重复', description: '重复', execute: () => null })
      },
    }
    expect(() => registry.register(duplicateDescriptor)).toThrow('命令 id 已注册')
    expect(registry.listPlugins().map((item) => item.id)).not.toContain('test.duplicate-descriptor')
    expect(registry.commands().map((item) => item.id)).not.toContain('test.new-command')
    expect(() => registry.register(plugin)).toThrow('插件 id 已注册')
  })

  it('keeps legacy menu descriptors and orders enabled context slots safely', () => {
    const registry = new PluginRegistry()
    const payload: ContextMenuPayload = { location: 'editor.selection', selectionText: '选区' }
    registry.register({
      id: 'test.context-menu',
      name: 'Context menu',
      version: '1.0.0',
      register(context) {
        context.registerMenu({ id: 'legacy', label: '旧菜单', location: 'tools', execute: () => undefined })
        context.registerMenu({ id: 'late', label: '后置', location: 'tools', contextLocations: ['editor.selection'], contextOrder: 200, execute: () => undefined })
        context.registerMenu({ id: 'early', label: '前置', location: 'tools', contextLocations: ['editor.selection'], contextOrder: 10, isEnabled: (input) => Boolean((input as ContextMenuPayload).selectionText), execute: () => undefined })
        context.registerMenu({ id: 'disabled', label: '禁用', location: 'tools', contextLocations: ['editor.selection'], isEnabled: () => { throw new Error('bad plugin') }, execute: () => undefined })
      },
    })
    expect(registry.contextMenus('editor.selection', payload).map((item) => item.id)).toEqual(['early', 'disabled', 'late'])
    expect(registry.contextMenus('editor.cursor', { location: 'editor.cursor' })).toEqual([])
  })
})
