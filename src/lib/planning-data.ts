import type { EntityRecord } from './types'

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
