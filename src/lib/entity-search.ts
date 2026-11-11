import { ENTITY_FIELDS, type EntityRecord } from './types'

export interface EntitySearchHit { field: string; excerpt: string; from: number; to: number }
const hiddenFields = new Set(['parentId', 'avatar', 'image', 'autoRecognize', 'autoRecognition', 'novelforgeEntity'])

function readable(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(readable).filter(Boolean).join('、')
  if (value && typeof value === 'object') return Object.values(value).map(readable).filter(Boolean).join('；')
  return ''
}

/** Search fields independently; show the actual matching field instead of just a title. */
export function searchEntity(entity: EntityRecord, query: string, includeContent = false): EntitySearchHit | null {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return null
  const fields: Array<[string, string]> = [
    ['名称', entity.title], ['别名', readable(entity.content.alias)], ['别名', readable(entity.content.aliases)],
    ['标签', entity.tags.join('、')],
  ]
  if (includeContent) {
    for (const [key, value] of Object.entries(entity.content)) {
      if (key === 'alias' || key === 'aliases' || hiddenFields.has(key) || key.startsWith('_')) continue
      const label = ENTITY_FIELDS[entity.kind].find(field => field.key === key)?.label ?? key
      fields.push([label, readable(value)])
    }
  }
  for (const [field, raw] of fields) {
    const text = raw.replace(/\s+/gu, ' ')
    const index = text.toLocaleLowerCase().indexOf(needle)
    if (index < 0) continue
    const start = Math.max(0, index - 24)
    const end = Math.min(text.length, Math.max(start + 96, index + needle.length))
    const prefix = start ? '…' : ''
    return { field, excerpt: prefix + text.slice(start, end) + (end < text.length ? '…' : ''), from: prefix.length + index - start, to: prefix.length + index - start + needle.length }
  }
  return null
}
