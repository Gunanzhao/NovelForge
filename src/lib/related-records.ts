import type { EntityRecord } from './types'
export function relatedRecords(selected: EntityRecord, entities: EntityRecord[]) {
  const title = selected.title.trim().toLocaleLowerCase()
  const matches = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(matches)
    if (value && typeof value === 'object') return Object.values(value).some(matches)
    if (typeof value !== 'string') return false
    const normalized = value.toLocaleLowerCase()
    return normalized.includes('[[' + title + ']]') || normalized.split(/[,，、;；\n]/u).map(part => part.trim()).some(part => part === title || part === selected.id.toLocaleLowerCase())
  }
  return entities.filter(entity => entity.id !== selected.id && ['foreshadowing', 'timeline', 'story-arc', 'scene', 'outline'].includes(entity.kind) && matches(entity.content))
}
