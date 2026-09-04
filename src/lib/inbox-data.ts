import type { EntityInput, EntityKind, EntityRecord } from './types'
import { parseStoryArc, storyArcEntityInputContent } from './story-arc-data'

export interface InboxItem {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
  processed: boolean
  processedInto?: {
    kind: string
    id: string
  }
}

export type InboxConversionKind = 'character' | 'location' | 'world' | 'scene' | 'foreshadowing' | 'note'

export function parseInboxItem(entity: EntityRecord): InboxItem {
  const processedInto = entity.content.processedInto
  return {
    id: entity.id,
    title: entity.title,
    content: typeof entity.content.content === 'string' ? entity.content.content : '',
    tags: entity.tags,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    processed: entity.content.processed === true || entity.content.processed === 'true',
    processedInto: processedInto && typeof processedInto === 'object'
      && typeof (processedInto as Record<string, unknown>).kind === 'string'
      && typeof (processedInto as Record<string, unknown>).id === 'string'
      ? { kind: (processedInto as Record<string, string>).kind, id: (processedInto as Record<string, string>).id }
      : undefined,
  }
}

export function inboxEntityContent(item: Pick<InboxItem, 'content' | 'processed' | 'processedInto'>): Record<string, unknown> {
  return {
    content: item.content,
    processed: item.processed,
    ...(item.processedInto ? { processedInto: item.processedInto } : {}),
  }
}

export function inboxConversionInput(projectPath: string, item: InboxItem, kind: InboxConversionKind): EntityInput {
  const contentByKind: Record<InboxConversionKind, Record<string, unknown>> = {
    character: { notes: item.content, firstAppearance: '' },
    location: { description: item.content },
    world: { description: item.content },
    scene: { result: item.content },
    foreshadowing: { description: item.content, status: 'planted' },
    note: { description: item.content },
  }
  return {
    projectPath,
    kind,
    id: null,
    title: item.title,
    content: contentByKind[kind],
    tags: item.tags,
  }
}

export function appendInboxMilestone(arc: EntityRecord, item: InboxItem, milestoneId: string) {
  const content = parseStoryArc(arc)
  return storyArcEntityInputContent({
    ...content,
    milestones: [...content.milestones, {
      id: milestoneId,
      title: item.title,
      note: item.content,
      order: content.milestones.length,
      status: 'planned',
    }],
  })
}

export const INBOX_CONVERSIONS: Array<{ kind: InboxConversionKind; label: string }> = [
  { kind: 'character', label: '转为人物' },
  { kind: 'location', label: '转为地点' },
  { kind: 'world', label: '转为世界观' },
  { kind: 'scene', label: '转为场景卡' },
  { kind: 'foreshadowing', label: '转为伏笔' },
  { kind: 'note', label: '转为普通笔记' },
]

export function isInboxTargetKind(value: EntityKind): value is InboxConversionKind {
  return INBOX_CONVERSIONS.some((item) => item.kind === value)
}
