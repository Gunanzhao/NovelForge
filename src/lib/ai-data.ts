import type { AiCompletionInput, EntityRecord, NodeRecord } from './types'

export type AiAction = 'continue' | 'polish' | 'rewrite' | 'summary'

export interface AiPreferences {
  endpoint: string
  model: string
}

export interface AiContextItem {
  id: string
  kind: 'node' | 'entity'
  title: string
  detail: string
}

const PREFERENCES_KEY = 'novelforge:ai-preferences:v1'

export const AI_ACTIONS: Array<{ id: AiAction; label: string; description: string }> = [
  { id: 'continue', label: '续写', description: '根据上下文继续写下一段' },
  { id: 'polish', label: '润色', description: '保持原意，改善节奏和表达' },
  { id: 'rewrite', label: '改写', description: '按写作要求重写选中的内容' },
  { id: 'summary', label: '摘要', description: '提炼情节、人物和关键线索' },
]

export function readAiPreferences(): AiPreferences {
  const defaults = { endpoint: '', model: 'local-writer' }
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Record<string, unknown>
    if (typeof value.endpoint === 'string') defaults.endpoint = value.endpoint
    if (typeof value.model === 'string' && value.model.trim()) defaults.model = value.model
  } catch {
    // 损坏的 Provider 偏好只回退到本地模式。
  }
  return defaults
}

export function writeAiPreferences(preferences: AiPreferences) {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)) } catch { /* 偏好不是核心数据 */ }
}

export function contextItems(nodes: NodeRecord[], entities: EntityRecord[], currentNodeId?: string): AiContextItem[] {
  const nodeItems = nodes.filter((node) => node.kind !== 'volume').sort((left, right) => left.orderIndex - right.orderIndex).map((node) => ({
    id: node.id, kind: 'node' as const, title: node.title, detail: node.id === currentNodeId ? '当前编辑章节' : node.kind === 'chapter' ? '正文 · 章节' : '正文 · 节',
  }))
  const entityItems = entities.filter((entity) => entity.kind !== 'attachment').sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title, 'zh-CN')).map((entity) => ({
    id: entity.id, kind: 'entity' as const, title: entity.title, detail: entity.kind,
  }))
  return [...nodeItems, ...entityItems]
}

export function buildAiPrompt(action: AiAction, context: Array<{ title: string; kind: string; content: string }>, instruction: string) {
  const actionLabel = AI_ACTIONS.find((item) => item.id === action)?.label ?? '辅助'
  const contextText = context.map((item) => `【${item.kind}｜${item.title}】\n${item.content.trim()}`).join('\n\n')
  return `任务：${actionLabel}\n\n写作要求：${instruction.trim() || '请严格依据上下文完成任务，避免添加无法推断的事实。'}\n\n明确选中的上下文：\n${contextText || '（未选择上下文）'}`
}

export function localAssist(action: AiAction, context: Array<{ title: string; kind: string; content: string }>, instruction: string): AiCompletionInput & { localContent: string } {
  const actionLabel = AI_ACTIONS.find((item) => item.id === action)?.label ?? '辅助'
  const excerpts = context.map((item) => `${item.title}：${item.content.replace(/\s+/gu, ' ').trim().slice(0, 260)}`).filter(Boolean)
  const body = excerpts.length ? excerpts.join('\n') : '尚未选择上下文。'
  const localContent = action === 'summary'
    ? `【本地摘要草稿】\n${body}\n\n写作要求：${instruction.trim() || '请继续补充并校对关键情节。'}`
    : `【本地${actionLabel}草稿】\n基于以下已选上下文生成的离线工作稿：\n${body}\n\n写作要求：${instruction.trim() || '请在此基础上继续编辑。'}`
  return { endpoint: '', apiKey: '', model: 'novelforge-local', systemPrompt: '', prompt: '', localContent }
}

