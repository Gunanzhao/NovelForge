import { paragraphRange, recentChapterIds } from './ai-data'
import type { EditorSelection, EntityRecord, ProjectData } from './types'

export type PromptPresetAction = 'generate' | 'analyze' | 'rewrite'

export interface PromptContextRule {
  variable: string
}

export interface PromptPreset {
  id: string
  name: string
  description: string
  prompt: string
  systemPrompt?: string
  action: PromptPresetAction
  defaultContexts: PromptContextRule[]
  createdAt: string
  updatedAt: string
}

export interface ResolvedPromptContext {
  variable: string
  label: string
  characters: number
}

export interface PromptResolution {
  prompt: string
  contexts: ResolvedPromptContext[]
  characters: number
  estimatedTokens: number
  errors: string[]
}

export interface PromptResolutionInput {
  data: ProjectData
  currentNodeId?: string
  currentContent?: string
  selection?: EditorSelection | null
  loadDocument: (nodeId: string) => Promise<string>
}

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/gu
const ENTITY_VARIABLES: Record<string, EntityRecord['kind']> = {
  character: 'character',
  location: 'location',
  world: 'world',
  storyArc: 'story-arc',
}

function presetAction(value: unknown): PromptPresetAction {
  return value === 'generate' || value === 'rewrite' || value === 'analyze' ? value : 'analyze'
}

export function parsePromptPreset(entity: EntityRecord): PromptPreset {
  const rules = Array.isArray(entity.content.defaultContexts) ? entity.content.defaultContexts.flatMap((item) => {
    if (typeof item === 'string') return [{ variable: item }]
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).variable === 'string') {
      return [{ variable: (item as Record<string, string>).variable }]
    }
    return []
  }) : []
  return {
    id: entity.id,
    name: entity.title,
    description: typeof entity.content.description === 'string' ? entity.content.description : '',
    prompt: typeof entity.content.prompt === 'string' ? entity.content.prompt : '',
    systemPrompt: typeof entity.content.systemPrompt === 'string' ? entity.content.systemPrompt : undefined,
    action: presetAction(entity.content.action),
    defaultContexts: rules,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  }
}

export function promptPresetContent(preset: Omit<PromptPreset, 'id' | 'name' | 'createdAt' | 'updatedAt'>): Record<string, unknown> {
  return {
    description: preset.description,
    prompt: preset.prompt,
    systemPrompt: preset.systemPrompt ?? '',
    action: preset.action,
    defaultContexts: preset.defaultContexts,
  }
}

function entityContext(entity: EntityRecord) {
  return JSON.stringify({ title: entity.title, tags: entity.tags, ...entity.content }, null, 2)
}

export async function resolvePromptTemplate(template: string, input: PromptResolutionInput): Promise<PromptResolution> {
  const variables = [...template.matchAll(VARIABLE_PATTERN)].map((match) => match[1].trim())
  const resolved = new Map<string, { content: string; label: string }>()
  const errors: string[] = []

  for (const variable of [...new Set(variables)]) {
    if (variable === 'selection') {
      const selection = input.selection
      if (!selection || selection.nodeId !== input.currentNodeId || !selection.text.trim()) {
        errors.push('无法解析上下文：当前没有可用选区。')
      } else {
        resolved.set(variable, { content: selection.text, label: '当前选区' })
      }
      continue
    }
    if (variable === 'currentParagraph') {
      const paragraph = input.currentContent ? paragraphRange(input.currentContent, input.selection?.from ?? 0) : null
      if (!paragraph) errors.push('无法解析上下文：当前段落为空。')
      else resolved.set(variable, { content: paragraph.text, label: '当前段落' })
      continue
    }
    if (variable === 'currentChapter') {
      if (!input.currentNodeId || input.currentContent === undefined) errors.push('无法解析上下文：当前没有打开章节。')
      else resolved.set(variable, { content: input.currentContent, label: '当前章节' })
      continue
    }
    const recent = variable.match(/^recentChapters:(1|3|5|10)$/u)
    if (recent) {
      const count = Number(recent[1])
      const ids = recentChapterIds(input.data.nodes, input.currentNodeId, count)
      if (!ids.length) {
        errors.push(`无法解析上下文：没有最近 ${count} 章。`)
      } else {
        const documents = await Promise.all(ids.map(async (id) => {
          const node = input.data.nodes.find((candidate) => candidate.id === id)
          const content = id === input.currentNodeId && input.currentContent !== undefined ? input.currentContent : await input.loadDocument(id)
          return `【${node?.title ?? id}】\n${content}`
        }))
        resolved.set(variable, { content: documents.join('\n\n'), label: `最近 ${ids.length} 章` })
      }
      continue
    }
    const entityMatch = variable.match(/^(character|location|world|storyArc):(.+)$/u)
    if (entityMatch) {
      const [, type, rawName] = entityMatch
      const name = rawName.trim()
      const kind = ENTITY_VARIABLES[type]
      const entity = input.data.entities.find((candidate) => candidate.kind === kind && candidate.title.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
      if (!entity) errors.push(`无法解析上下文：${type}:${name} 不存在。`)
      else resolved.set(variable, { content: entityContext(entity), label: `${type}:${entity.title}` })
      continue
    }
    errors.push(`无法解析上下文：不支持变量 {{${variable}}}。`)
  }

  if (errors.length) return { prompt: template, contexts: [], characters: 0, estimatedTokens: 0, errors }
  const prompt = template.replace(VARIABLE_PATTERN, (_match, rawVariable: string) => resolved.get(rawVariable.trim())?.content ?? '')
  const contexts = [...resolved.entries()].map(([variable, value]) => ({
    variable,
    label: value.label,
    characters: Array.from(value.content).length,
  }))
  const characters = Array.from(prompt).length
  return { prompt, contexts, characters, estimatedTokens: Math.ceil(characters / 4), errors: [] }
}
