import type { EntityRecord, NodeRecord } from './types'

export function contentText(entity: EntityRecord | undefined, key: string, fallback = '') {
  if (!entity) return fallback
  const value = entity.content[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => String(item)).join('、')
  return fallback
}

export function contentNumber(entity: EntityRecord | undefined, key: string, fallback = 0) {
  const raw = contentText(entity, key, '').trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function sortPlanningEntities(entities: EntityRecord[]) {
  return [...entities].sort((left, right) => {
    const order = contentNumber(left, 'order', Number.MAX_SAFE_INTEGER) - contentNumber(right, 'order', Number.MAX_SAFE_INTEGER)
    if (order !== 0) return order
    return left.createdAt.localeCompare(right.createdAt)
  })
}

export function reorderItems<T extends { id: string }>(items: T[], sourceId: string, targetId: string) {
  if (sourceId === targetId) return items
  const sourceIndex = items.findIndex((item) => item.id === sourceId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return items
  const next = [...items]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

function timelineDateValue(entity: EntityRecord) {
  const date = contentText(entity, 'date').trim()
  if (!date) return { rank: 2, value: Number.MAX_SAFE_INTEGER, text: '' }
  const parsed = Date.parse(date)
  if (Number.isFinite(parsed)) return { rank: 0, value: parsed, text: date }
  const number = date.match(/\d+/u)
  if (number) return { rank: 1, value: Number(number[0]), text: date }
  return { rank: 2, value: Number.MAX_SAFE_INTEGER, text: date }
}

function timelineTimeValue(value: string) {
  const text = value.trim()
  const numeric = text.match(/(\d{1,2})(?::(\d{1,2}))?/u)
  if (numeric) return Number(numeric[1]) * 60 + Number(numeric[2] ?? 0)
  const periods = ['凌晨', '清晨', '早', '上午', '中午', '下午', '傍晚', '晚上', '夜', '深夜']
  const index = periods.findIndex((period) => text.includes(period))
  return index >= 0 ? 24 * 60 + index : Number.MAX_SAFE_INTEGER
}

export function sortTimelineEntities(entities: EntityRecord[]) {
  return [...entities].sort((left, right) => {
    const leftDate = timelineDateValue(left)
    const rightDate = timelineDateValue(right)
    if (leftDate.rank !== rightDate.rank) return leftDate.rank - rightDate.rank
    if (leftDate.value !== rightDate.value) return leftDate.value - rightDate.value
    const leftTime = timelineTimeValue(contentText(left, 'time'))
    const rightTime = timelineTimeValue(contentText(right, 'time'))
    if (leftTime !== rightTime) return leftTime - rightTime
    const time = contentText(left, 'time').localeCompare(contentText(right, 'time'), 'zh-CN')
    if (time !== 0) return time
    const date = leftDate.text.localeCompare(rightDate.text, 'zh-CN')
    if (date !== 0) return date
    return left.createdAt.localeCompare(right.createdAt)
  })
}

export interface TimelineFilters {
  query?: string
  character?: string
  location?: string
  chapter?: string
}

export function filterTimelineEntities(entities: EntityRecord[], filters: TimelineFilters) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''
  const character = filters.character?.trim().toLocaleLowerCase() ?? ''
  const location = filters.location?.trim().toLocaleLowerCase() ?? ''
  const chapter = filters.chapter?.trim().toLocaleLowerCase() ?? ''
  return entities.filter((event) => {
    const fields = [
      event.title, contentText(event, 'description'), contentText(event, 'characters'),
      contentText(event, 'location'), contentText(event, 'chapters'),
    ].join(' ').toLocaleLowerCase()
    if (query && !fields.includes(query)) return false
    if (character && !contentText(event, 'characters').toLocaleLowerCase().includes(character)) return false
    if (location && !contentText(event, 'location').toLocaleLowerCase().includes(location)) return false
    if (chapter && !contentText(event, 'chapters').toLocaleLowerCase().includes(chapter)) return false
    return true
  })
}

export function chapterReferenceTokens(value: string) {
  return value.split(/[，,、;；\s]+/u).map((item) => item.trim()).filter(Boolean)
}

export function findChapterByReference(chapters: NodeRecord[], reference: string) {
  const normalized = reference.trim()
  if (!normalized) return undefined
  const exact = chapters.find((chapter) => chapter.title.trim() === normalized)
  if (exact) return exact
  const number = normalized.match(/(?:第\s*)?(\d+)\s*章?/u)
  if (!number) return undefined
  const index = Number(number[1]) - 1
  return Number.isInteger(index) && index >= 0
    ? [...chapters].sort((left, right) => left.orderIndex - right.orderIndex)[index]
    : undefined
}

export type ForeshadowingStatus = 'planned' | 'planted' | 'paid-off' | 'abandoned'

export const FORESHADOWING_STATUSES: Array<{ id: ForeshadowingStatus; label: string; description: string }> = [
  { id: 'planned', label: '待埋设', description: '还没有写入正文' },
  { id: 'planted', label: '已埋设', description: '已经在正文中出现' },
  { id: 'paid-off', label: '已回收', description: '伏笔已经得到回应' },
  { id: 'abandoned', label: '已搁置', description: '暂时不再继续推进' },
]

export function normalizeForeshadowingStatus(value: string): ForeshadowingStatus {
  const normalized = value.trim().toLocaleLowerCase()
  if (['planted', '已埋设', '已埋', '埋设'].includes(normalized)) return 'planted'
  if (['paid-off', 'paid_off', 'paidoff', 'resolved', '已回收', '已解决', '回收'].includes(normalized)) return 'paid-off'
  if (['abandoned', '已搁置', '搁置', '放弃', '废弃'].includes(normalized)) return 'abandoned'
  return 'planned'
}

export function foreshadowingStatusLabel(value: string) {
  return FORESHADOWING_STATUSES.find((status) => status.id === normalizeForeshadowingStatus(value))?.label ?? '待埋设'
}
