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
  | 'open-story-arcs'
  | 'new-story-arc'
  | 'open-character-statistics'
  | 'open-prompt-presets'
  | 'run-prompt-preset'
  | 'open-inbox'
  | 'quick-inbox'
  | 'toggle-chapter-checklist'
  | 'toggle-bold'
  | 'toggle-italic'

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
  { id: 'open-story-arcs', label: '打开剧情线', description: '查看和编辑项目剧情线', keywords: ['剧情线', 'story', 'arc'] },
  { id: 'new-story-arc', label: '新建剧情线', description: '创建一条新的剧情线', keywords: ['新建', '剧情线', 'story', 'arc'] },
  { id: 'open-character-statistics', label: '打开人物出场统计', description: '查看人物出场、共同出现和章节矩阵', keywords: ['人物', '出场', '统计', '矩阵'] },
  { id: 'open-prompt-presets', label: '打开 Prompt 模板', description: '管理项目级 AI Prompt 模板', keywords: ['AI', 'Prompt', '模板'] },
  { id: 'run-prompt-preset', label: '运行 Prompt 模板', description: '预览并运行第一个项目模板', keywords: ['AI', 'Prompt', '运行', '模板'] },
  { id: 'open-inbox', label: '打开灵感箱', description: '查看未整理和已整理灵感', keywords: ['灵感', 'inbox', '整理'] },
  { id: 'quick-inbox', label: '快速记录灵感', description: '不离开当前章节记录一条灵感', keywords: ['灵感', '记录', 'inbox'], defaultShortcut: 'Ctrl+Shift+I' },
  { id: 'toggle-chapter-checklist', label: '切换章节 Checklist', description: '完成当前章节的下一个待办项', keywords: ['章节', 'Checklist', '完成', '流程'] },
  { id: 'toggle-bold', label: '切换粗体', description: '对当前编辑器选区应用或取消粗体', keywords: ['粗体', 'bold', '编辑'], defaultShortcut: 'Ctrl+B' },
  { id: 'toggle-italic', label: '切换斜体', description: '对当前编辑器选区应用或取消斜体', keywords: ['斜体', 'italic', '编辑'], defaultShortcut: 'Ctrl+I' },
]

export function dispatchCommand(id: CommandId) {
  window.dispatchEvent(new CustomEvent('novelforge:run-command', { detail: id }))
}

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
    'open-story-arcs': 'story-arc',
    'open-character-statistics': 'character-statistics',
    'open-prompt-presets': 'ai', 'run-prompt-preset': 'ai',
    'open-inbox': 'inbox',
  }
  return views[commandId]
}

export { STORAGE_KEY as COMMAND_SHORTCUT_STORAGE_KEY }
