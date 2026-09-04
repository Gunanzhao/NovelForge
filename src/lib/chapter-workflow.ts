import type { EntityInput, EntityRecord, NodeRecord, ProjectData } from './types'

export type ChapterWorkflowStatus = 'draft' | 'first-draft-complete' | 'self-check-complete' | 'proofread-1' | 'proofread-2' | 'final'
export type ChapterWorkflowFilter = 'all' | 'incomplete' | 'not-final' | 'consistency'

export interface ChecklistItem {
  id: string
  label: string
  completed: boolean
}

export interface ChapterChecklist {
  id?: string
  chapterId: string
  workflowStatus: ChapterWorkflowStatus
  items: ChecklistItem[]
}

export interface ChecklistTemplate {
  id?: string
  items: Array<{ id: string; label: string }>
}

export const CHAPTER_WORKFLOW_STATUSES: Array<{ id: ChapterWorkflowStatus; label: string }> = [
  { id: 'draft', label: '草稿' },
  { id: 'first-draft-complete', label: '初稿完成' },
  { id: 'self-check-complete', label: '自检完成' },
  { id: 'proofread-1', label: '一校' },
  { id: 'proofread-2', label: '二校' },
  { id: 'final', label: '定稿' },
]

export const DEFAULT_CHECKLIST_TEMPLATE: ChecklistTemplate = {
  items: [
    { id: 'body-complete', label: '正文完成' },
    { id: 'typo-check', label: '错别字检查' },
    { id: 'character-consistency', label: '人物一致性检查' },
    { id: 'timeline-check', label: '时间线检查' },
    { id: 'foreshadowing-check', label: '伏笔检查' },
    { id: 'polish', label: '润色' },
    { id: 'final-read', label: '最终复读' },
  ],
}

function safeId(label: string, index: number) {
  const id = label.trim().toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/gu, '')
  return id || `item-${index + 1}`
}

function templateItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item === 'string' && item.trim()) return [{ id: safeId(item, index), label: item.trim() }]
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.label !== 'string' || !record.label.trim()) return []
    return [{ id: typeof record.id === 'string' && record.id ? record.id : safeId(record.label, index), label: record.label.trim() }]
  })
}

export function parseChecklistTemplate(entity?: EntityRecord | null): ChecklistTemplate {
  const parsed = templateItems(entity?.content.items)
  return { id: entity?.id, items: parsed.length ? parsed : DEFAULT_CHECKLIST_TEMPLATE.items }
}

function workflowStatus(value: unknown): ChapterWorkflowStatus {
  return CHAPTER_WORKFLOW_STATUSES.some((item) => item.id === value) ? value as ChapterWorkflowStatus : 'draft'
}

export function parseChapterChecklist(entity: EntityRecord): ChapterChecklist {
  const chapterId = typeof entity.content.chapterId === 'string' ? entity.content.chapterId : ''
  const baseItems = templateItems(entity.content.items)
  const raw = Array.isArray(entity.content.items) ? entity.content.items : []
  const completed = new Map(raw.flatMap((item) => item && typeof item === 'object'
    ? [[String((item as Record<string, unknown>).id ?? ''), (item as Record<string, unknown>).completed === true] as const]
    : []))
  return {
    id: entity.id,
    chapterId,
    workflowStatus: workflowStatus(entity.content.workflowStatus),
    items: baseItems.map((item) => ({ ...item, completed: completed.get(item.id) ?? false })),
  }
}

export function checklistForChapter(entities: EntityRecord[], chapterId: string) {
  const entity = entities.find((candidate) => candidate.kind === 'chapter-checklist' && candidate.content.chapterId === chapterId)
  return entity ? parseChapterChecklist(entity) : null
}

export function chapterChecklistInput(projectPath: string, chapter: NodeRecord, entities: EntityRecord[], checklist?: ChapterChecklist): EntityInput {
  const templateEntity = entities.find((entity) => entity.kind === 'checklist-template')
  const template = parseChecklistTemplate(templateEntity)
  const value = checklist ?? {
    chapterId: chapter.id,
    workflowStatus: 'draft' as const,
    items: template.items.map((item) => ({ ...item, completed: false })),
  }
  return {
    projectPath,
    kind: 'chapter-checklist',
    id: value.id ?? null,
    title: `${chapter.title} · Checklist`,
    tags: ['章节流程'],
    content: {
      chapterId: chapter.id,
      workflowStatus: value.workflowStatus,
      items: value.items,
    },
  }
}

export function checklistProgress(checklist: ChapterChecklist | null) {
  const total = checklist?.items.length ?? 0
  const completed = checklist?.items.filter((item) => item.completed).length ?? 0
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 }
}

export function chapterMatchesWorkflowFilter(chapter: NodeRecord, entities: EntityRecord[], filter: ChapterWorkflowFilter) {
  if (filter === 'all') return true
  const checklist = checklistForChapter(entities, chapter.id)
  if (filter === 'not-final') return checklist?.workflowStatus !== 'final'
  if (filter === 'consistency') return !(checklist?.items.find((item) => item.id === 'character-consistency' || item.label.includes('人物一致性'))?.completed)
  const progress = checklistProgress(checklist)
  return progress.total === 0 || progress.completed < progress.total
}

export interface VolumeWorkflowSummary {
  volume: NodeRecord
  chapterCount: number
  itemProgress: Array<{ label: string; completed: number; total: number }>
  finalCount: number
}

export function workflowDashboard(data: ProjectData): VolumeWorkflowSummary[] {
  return data.nodes.filter((node) => node.kind === 'volume').sort((left, right) => left.orderIndex - right.orderIndex).map((volume) => {
    const chapters = data.nodes.filter((node) => node.kind === 'chapter' && node.parentId === volume.id)
    const checklists = chapters.map((chapter) => checklistForChapter(data.entities, chapter.id))
    const labels = [...new Set(checklists.flatMap((checklist) => checklist?.items.map((item) => item.label) ?? []))]
    return {
      volume,
      chapterCount: chapters.length,
      itemProgress: labels.map((label) => ({
        label,
        completed: checklists.filter((checklist) => checklist?.items.some((item) => item.label === label && item.completed)).length,
        total: chapters.length,
      })),
      finalCount: checklists.filter((checklist) => checklist?.workflowStatus === 'final').length,
    }
  })
}
