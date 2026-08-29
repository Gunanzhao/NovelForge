import type { ViewId } from './types'

export type CommandId =
  | 'open-palette'
  | 'save-document'
  | 'new-project'
  | 'close-project'
  | 'open-search'
  | 'open-full-search'
  | 'quick-open'
  | 'toggle-focus'
  | 'open-dashboard'
  | 'open-manuscript'
  | 'open-outline'
  | 'open-timeline'
  | 'open-foreshadowing'
  | 'open-relationship'
  | 'open-attachment'
  | 'open-consistency'
  | 'open-statistics'
  | 'open-ai'

export interface CommandDescriptor {
  id: CommandId
  label: string
  description: string
  keywords: string[]
  defaultShortcut?: string
}

export const COMMANDS: CommandDescriptor[] = [
  { id: 'open-palette', label: '打开命令面板', description: '搜索并执行工作台命令', keywords: ['命令', 'command', 'palette'], defaultShortcut: 'Ctrl+Shift+P' },
  { id: 'save-document', label: '保存当前正文', description: '立即保存正在编辑的章节', keywords: ['保存', '正文', 'save'], defaultShortcut: 'Ctrl+S' },
  { id: 'new-project', label: '新建小说项目', description: '打开新建项目对话框', keywords: ['新建', '项目', '小说'], defaultShortcut: 'Ctrl+N' },
  { id: 'close-project', label: '关闭当前项目', description: '保存后返回项目欢迎页', keywords: ['关闭', '项目', 'close'], defaultShortcut: 'Ctrl+W' },
  { id: 'open-search', label: '当前文档搜索', description: '在当前章节中搜索关键词', keywords: ['搜索', '查找', '当前', 'find'], defaultShortcut: 'Ctrl+F' },
  { id: 'open-full-search', label: '全项目搜索', description: '搜索整部小说正文和资料库', keywords: ['搜索', '全文', '项目', 'search'], defaultShortcut: 'Ctrl+Shift+F' },
  { id: 'quick-open', label: '快速打开', description: '按名称打开章节、人物、地点或 Wiki 条目', keywords: ['打开', '跳转', 'quick', 'open'], defaultShortcut: 'Ctrl+P' },
  { id: 'toggle-focus', label: '切换专注模式', description: '隐藏侧栏，专心编辑正文', keywords: ['专注', 'focus'], defaultShortcut: 'F11' },
  { id: 'open-dashboard', label: '打开总览', description: '查看项目进度和写作统计', keywords: ['总览', 'dashboard'], defaultShortcut: 'Ctrl+1' },
  { id: 'open-manuscript', label: '打开正文', description: '回到章节编辑器', keywords: ['正文', '编辑', 'manuscript'], defaultShortcut: 'Ctrl+2' },
  { id: 'open-outline', label: '打开写作规划', description: '查看大纲、场景卡和看板', keywords: ['规划', '大纲', '看板', 'outline'], defaultShortcut: 'Ctrl+3' },
  { id: 'open-timeline', label: '打开时间线', description: '查看故事事件时间线', keywords: ['时间线', '事件', 'timeline'], defaultShortcut: 'Ctrl+4' },
  { id: 'open-foreshadowing', label: '打开伏笔', description: '查看和跟踪伏笔状态', keywords: ['伏笔', '回收', 'foreshadowing'], defaultShortcut: 'Ctrl+5' },
  { id: 'open-relationship', label: '打开人物关系图', description: '查看人物关系网络', keywords: ['人物', '关系', 'graph', 'relationship'], defaultShortcut: 'Ctrl+6' },
  { id: 'open-attachment', label: '打开资料附件', description: '管理项目内的研究资料和附件', keywords: ['资料', '附件', 'research', 'attachment'], defaultShortcut: 'Ctrl+7' },
  { id: 'open-consistency', label: '打开一致性检查', description: '扫描断开的 Wiki 和章节引用', keywords: ['一致性', '检查', 'consistency'], defaultShortcut: 'Ctrl+8' },
  { id: 'open-statistics', label: '打开详细统计', description: '查看写作趋势和章节排行', keywords: ['统计', '趋势', 'statistics'], defaultShortcut: 'Ctrl+9' },
  { id: 'open-ai', label: '打开 AI 辅助', description: '显式选择上下文并运行写作辅助', keywords: ['AI', '续写', '润色', '摘要', 'assistant'], defaultShortcut: 'Ctrl+0' },
]

export type ShortcutMap = Record<CommandId, string>

const STORAGE_KEY = 'novelforge:command-shortcuts:v1'

export function defaultShortcutMap(): ShortcutMap {
  return Object.fromEntries(COMMANDS.map((command) => [command.id, command.defaultShortcut ?? ''])) as ShortcutMap
}

export function normalizeShortcut(value: string) {
  return value.split('+').map((part) => {
    const normalized = part.trim().toLowerCase()
    if (normalized === 'control' || normalized === 'ctrl' || normalized === 'meta' || normalized === 'cmd' || normalized === 'command') return 'Ctrl'
    if (normalized === 'alt' || normalized === 'option') return 'Alt'
    if (normalized === 'shift') return 'Shift'
    if (normalized === ' ') return 'Space'
    return normalized.length === 1 ? normalized.toUpperCase() : normalized.charAt(0).toUpperCase() + normalized.slice(1)
  }).filter(Boolean).join('+')
}

export function readShortcutMap(): ShortcutMap {
  const defaults = defaultShortcutMap()
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    for (const command of COMMANDS) {
      const value = parsed[command.id]
      if (typeof value === 'string') defaults[command.id] = normalizeShortcut(value)
    }
  } catch {
    // 损坏的快捷键偏好只回退到默认值，不影响项目数据。
  }
  return defaults
}

export function writeShortcutMap(shortcuts: ShortcutMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts))
  } catch {
    // 偏好写入失败不阻断写作。
  }
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent) {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return ''
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  let key = event.key
  if (key === ' ') key = 'Space'
  if (key.length === 1) key = key.toUpperCase()
  if (key === 'Esc') key = 'Escape'
  if (!parts.length && !/^F\d{1,2}$/u.test(key)) return ''
  parts.push(key)
  return normalizeShortcut(parts.join('+'))
}

export function commandView(commandId: CommandId): ViewId | undefined {
  const views: Partial<Record<CommandId, ViewId>> = {
    'open-dashboard': 'dashboard', 'open-manuscript': 'manuscript', 'open-outline': 'outline',
    'open-timeline': 'timeline', 'open-foreshadowing': 'foreshadowing', 'open-relationship': 'relationship',
    'open-search': 'search', 'open-full-search': 'search', 'open-attachment': 'attachment', 'open-consistency': 'consistency', 'open-statistics': 'statistics', 'open-ai': 'ai',
  }
  return views[commandId]
}

export { STORAGE_KEY as COMMAND_SHORTCUT_STORAGE_KEY }
