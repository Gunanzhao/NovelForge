import type { AiCompletionInput, EntityRecord, NodeRecord } from './types'
import { sortManuscriptNodes } from './planning-data'

export type AiAction = 'continue' | 'polish' | 'rewrite' | 'expand' | 'shrink' | 'summary' | 'chapter-summary' | 'outline' | 'dialogue' | 'setting-advice' | 'name'

export interface AiPreferences {
  endpoint: string
  model: string
  providerName?: string
  temperature?: number
  maxTokens?: number
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
  { id: 'expand', label: '扩写', description: '扩展细节、氛围和动作层次' },
  { id: 'shrink', label: '缩写', description: '压缩冗余内容，保留关键情节' },
  { id: 'summary', label: '摘要', description: '提炼情节、人物和关键线索' },
  { id: 'chapter-summary', label: '章节摘要', description: '生成可回看的章节摘要' },
  { id: 'outline', label: '生成大纲', description: '根据上下文整理剧情大纲' },
  { id: 'dialogue', label: '角色对话', description: '生成符合人物设定的对话草稿' },
  { id: 'setting-advice', label: '设定建议', description: '发现并补充世界观设定空白' },
  { id: 'name', label: '名字生成', description: '根据上下文提供命名候选' },
]

export function readAiPreferences(): AiPreferences {
  const defaults: AiPreferences = { endpoint: '', model: 'local-writer' }
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Record<string, unknown>
    if (typeof value.endpoint === 'string') defaults.endpoint = value.endpoint
    if (typeof value.model === 'string' && value.model.trim()) defaults.model = value.model
    if (typeof value.providerName === 'string') defaults.providerName = value.providerName
    if (typeof value.temperature === 'number' && Number.isFinite(value.temperature)) defaults.temperature = Math.max(0, Math.min(2, value.temperature))
    if (typeof value.maxTokens === 'number' && Number.isFinite(value.maxTokens)) defaults.maxTokens = Math.max(1, Math.min(32_000, Math.round(value.maxTokens)))
  } catch {
    // 损坏的 Provider 偏好只回退到本地模式。
  }
  return defaults
}

export function writeAiPreferences(preferences: AiPreferences) {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)) } catch { /* 偏好不是核心数据 */ }
}

export function contextItems(nodes: NodeRecord[], entities: EntityRecord[], currentNodeId?: string): AiContextItem[] {
  const nodeItems = sortManuscriptNodes(nodes).map((node) => ({
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
