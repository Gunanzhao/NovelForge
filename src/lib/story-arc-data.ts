import type { ConsistencyIssue, EntityRecord, ProjectData } from './types'
import { sortChapterNodes } from './planning-data'

export type StoryArcStatus = 'planned' | 'active' | 'paused' | 'completed' | 'abandoned'
export type StoryArcMilestoneStatus = 'planned' | 'completed'

export interface StoryArcMilestone {
  id: string
  title: string
  chapterId?: string
  order: number
  status: StoryArcMilestoneStatus
  note?: string
}

export interface StoryArcContent {
  description: string
  status: StoryArcStatus
  color: string
  priority: number
  chapterIds: string[]
  milestones: StoryArcMilestone[]
}

export const STORY_ARC_STATUSES: Array<{ id: StoryArcStatus; label: string }> = [
  { id: 'planned', label: '计划中' },
  { id: 'active', label: '进行中' },
  { id: 'paused', label: '暂停' },
  { id: 'completed', label: '已完成' },
  { id: 'abandoned', label: '已放弃' },
]

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

function status(value: unknown): StoryArcStatus {
  return STORY_ARC_STATUSES.some((item) => item.id === value) ? value as StoryArcStatus : 'planned'
}

export function parseStoryArc(entity?: EntityRecord | null): StoryArcContent {
  const content = entity?.content ?? {}
  const milestones = Array.isArray(content.milestones) ? content.milestones.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return []
    const record = value as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.title !== 'string') return []
    return [{
      id: record.id,
      title: record.title,
      chapterId: typeof record.chapterId === 'string' && record.chapterId ? record.chapterId : undefined,
      order: typeof record.order === 'number' && Number.isFinite(record.order) ? record.order : index,
      status: record.status === 'completed' ? 'completed' as const : 'planned' as const,
      note: typeof record.note === 'string' ? record.note : undefined,
    }]
  }).sort((left, right) => left.order - right.order).map((item, index) => ({ ...item, order: index })) : []
  return {
    description: typeof content.description === 'string' ? content.description : '',
    status: status(content.status),
    color: typeof content.color === 'string' ? content.color : '#8b5cf6',
    priority: typeof content.priority === 'number' && Number.isFinite(content.priority) ? content.priority : 0,
    chapterIds: [...new Set(stringArray(content.chapterIds))],
    milestones,
  }
}

export function moveStoryArcMilestone(milestones: StoryArcMilestone[], sourceId: string, targetId: string) {
  const source = milestones.findIndex((item) => item.id === sourceId)
  const target = milestones.findIndex((item) => item.id === targetId)
  if (source < 0 || target < 0 || source === target) return milestones
  const next = milestones.slice()
  const [moved] = next.splice(source, 1)
  next.splice(target, 0, moved)
  return next.map((item, index) => ({ ...item, order: index }))
}

function issue(code: string, title: string, detail: string, arc: EntityRecord): ConsistencyIssue {
  return {
    id: `${code}:${arc.id}:${title}`,
    severity: 'warning',
    code,
    title,
    detail,
    refId: arc.id,
    refKind: arc.kind,
    path: arc.filePath,
  }
}

export function storyArcHealthIssues(data: ProjectData, staleChapterGap = 5): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  const chapterIds = new Set(data.nodes.filter((node) => node.kind === 'chapter').map((node) => node.id))
  const orderedChapters = sortChapterNodes(data.nodes)
  const chapterOrder = new Map(orderedChapters.map((chapter, index) => [chapter.id, index]))
  const latestIndex = orderedChapters.length - 1
  for (const arc of data.entities.filter((entity) => entity.kind === 'story-arc')) {
    const content = parseStoryArc(arc)
    const broken = content.chapterIds.filter((id) => !chapterIds.has(id))
    if (broken.length) {
      issues.push(issue('broken-story-arc-chapter', '剧情线章节关联失效', `剧情线“${arc.title}”包含 ${broken.length} 个已删除章节引用。`, arc))
    }
    const orphanMilestones = content.milestones.filter((milestone) => milestone.chapterId && !chapterIds.has(milestone.chapterId))
    for (const milestone of orphanMilestones) {
      issues.push(issue('story-arc-orphan-milestone', '剧情线节点引用失效', `节点“${milestone.title}”引用的章节已不存在。`, arc))
    }
    const openMilestones = content.milestones.filter((milestone) => milestone.status !== 'completed')
    if (content.status === 'completed' && openMilestones.length) {
      issues.push(issue('story-arc-completed-with-open-milestone', '已完成剧情线仍有未完成节点', `剧情线“${arc.title}”仍有 ${openMilestones.length} 个计划节点未完成。`, arc))
    }
    const validIndexes = content.chapterIds.map((id) => chapterOrder.get(id)).filter((value): value is number => value !== undefined)
    const lastProgress = validIndexes.length ? Math.max(...validIndexes) : -1
    if (content.status === 'active' && openMilestones.length && latestIndex - lastProgress >= staleChapterGap) {
      issues.push(issue('story-arc-stale', '剧情线可能长期未推进', `剧情线“${arc.title}”已连续 ${latestIndex - lastProgress} 章没有关联推进。`, arc))
    }
  }
  return issues
}

export function storyArcEntityInputContent(content: StoryArcContent): Record<string, unknown> {
  return {
    ...content,
    priority: Math.trunc(content.priority),
    chapterIds: [...new Set(content.chapterIds)],
    milestones: content.milestones.map((item, index) => ({ ...item, order: index })),
  }
}
