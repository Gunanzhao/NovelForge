import type { EntityRecord, EntityState, EntityVersion } from './types'

export function entityState(entity: EntityRecord): EntityState {
  return { title: entity.title, content: structuredClone(entity.content), tags: [...entity.tags] }
}
export function stableValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableValue).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableValue((value as Record<string, unknown>)[key])).join(',') + '}'
  return JSON.stringify(value) ?? 'undefined'
}
export function entityVersionChanges(current: EntityState, version: EntityVersion) {
  const fields = ['title', 'tags', ...[...new Set([...Object.keys(current.content), ...Object.keys(version.state.content)])].sort().map(key => 'content.' + key)]
  const read = (state: EntityState, key: string): unknown => key === 'title' ? state.title : key === 'tags' ? state.tags : state.content[key.slice(8)]
  return fields.map(key => ({ key, current: read(current, key), previous: read(version.state, key) })).filter(change => stableValue(change.current) !== stableValue(change.previous))
}
