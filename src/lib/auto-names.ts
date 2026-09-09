import type { EntityRecord } from './types'
import { protectedMarkdownRanges } from './markdown-protected-ranges'
export interface AutoNameMatch { from: number; to: number; text: string; ids: string[] }
interface Trie { next: Map<string, Trie>; ids?: string[]; latin?: boolean }
export const nameKey = (text: string) => text.trim().replace(/[A-Z]/g, char => char.toLowerCase())
export function buildNameTrie(entities: EntityRecord[]): Trie {
  const root: Trie = { next: new Map() }
  const ignores = entities.filter(entity => entity.kind === 'mention-ignore')
  const ignored = new Set(ignores.filter(e => !e.content.entityId).map(e => nameKey(String(e.content.text || e.title))))
  const disabled = new Set(ignores.map(e => e.content.entityId).filter(Boolean))
  for (const entity of entities) {
    if (!['character', 'location', 'world'].includes(entity.kind) || disabled.has(entity.id)) continue
    const raw = entity.content.alias ?? entity.content.aliases
    const aliases = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : typeof raw === 'string' ? raw.split(/[,，、;；/\n]/u) : []
    for (const term of new Set([entity.title, ...aliases].map(nameKey))) {
      if ([...term].length < 2 || ignored.has(term) || /[\r\n]/.test(term)) continue
      let node = root
      for (const char of term) { if (!node.next.has(char)) node.next.set(char, { next: new Map() }); node = node.next.get(char)! }
      node.ids ??= []; if (!node.ids.includes(entity.id)) node.ids.push(entity.id)
      node.latin = /[a-z]/.test(term)
    }
  }
  return root
}
export function scanAutoNames(source: string, trie: Trie, visible = [{ from: 0, to: source.length }], protectedRanges = protectedMarkdownRanges(source)): AutoNameMatch[] {
  const blocked = protectedRanges.slice().sort((a,b) => a.start-b.start)
  const result: AutoNameMatch[] = []
  for (const range of visible) {
    let block = 0
    for (let from = range.from; from < Math.min(range.to, source.length);) {
      while (block < blocked.length && blocked[block].end <= from) block++
      if (block < blocked.length && blocked[block].start <= from) { from = blocked[block].end; continue }
      let node = trie, end = from, best: AutoNameMatch | undefined
      while (end < source.length) {
        const char = String.fromCodePoint(source.codePointAt(end)!)
        const next = node.next.get(char.replace(/[A-Z]/g, value => value.toLowerCase())); if (!next) break
        node = next; end += char.length
        if (blocked[block] && end > blocked[block].start) break
        if (node.ids && (!node.latin || (!/[A-Za-z0-9_]/.test(source[from-1] || '') && !/[A-Za-z0-9_]/.test(source[end] || '')))) best = { from, to: end, text: source.slice(from,end), ids: node.ids }
      }
      if (best) { result.push(best); from = best.to } else from += String.fromCodePoint(source.codePointAt(from)!).length
    }
  }
  return result
}
