import { ChangeSet, StateEffect, type ChangeDesc } from '@codemirror/state'

export interface AiAcceptance { token: string; ids: string[]; accepted: boolean }
// IDs do not depend on document offsets; the task maps offsets using every editor change.
export const aiAcceptanceEffect = StateEffect.define<AiAcceptance>()

export interface AiRange { from: number; to: number; conflict: boolean }
export interface AiEdit extends AiRange {
  id: string
  before: string
  after: string
  state: 'pending' | 'accepted' | 'rejected'
}

/** Track the original target, never the live selection. Boundary insertions stay outside a selection. */
export function mapAiRange(range: AiRange, changes: ChangeDesc): AiRange {
  let conflict = range.conflict
  changes.iterChangedRanges((from, to) => {
    if (range.from === range.to) {
      if (from <= range.from && to >= range.from) conflict = true
    } else if (from === to ? from > range.from && from < range.to : from < range.to && to > range.from) conflict = true
  })
  const from = changes.mapPos(range.from, 1)
  const to = range.from === range.to ? from : changes.mapPos(range.to, -1)
  return { from, to: Math.max(from, to), conflict }
}

/** A conservative fallback for non-editor updates (external reloads, history restore). */
export function textChanges(before: string, after: string): ChangeSet {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  // Do not split a surrogate pair.
  if (start && /[\uD800-\uDBFF]/u.test(before[start - 1])) start--
  let endBefore = before.length, endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter-- }
  if (endBefore < before.length && /[\uDC00-\uDFFF]/u.test(before[endBefore])) { endBefore++; endAfter++ }
  return ChangeSet.of({ from: start, to: endBefore, insert: after.slice(start, endAfter) }, before.length)
}

/** Bounded LCS: character edits for ordinary passages, sentence edits for long passages. */
export function aiEdits(before: string, after: string, offset = 0): AiEdit[] {
  if (before === after) return []
  const tokens = (text: string) => Array.from(text)
  let a = tokens(before), b = tokens(after)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const base = offset + a.slice(0, prefix).join('').length
  a = a.slice(prefix, a.length - suffix); b = b.slice(prefix, b.length - suffix)
  if (a.length * b.length > 2_000_000) {
    const segments = (value: string) => value.match(/[^。！？\n]+[。！？\n]?|[。！？\n]/gu) ?? []
    a = segments(a.join('')); b = segments(b.join(''))
  }
  if (a.length * b.length > 2_000_000 || a.length + b.length > 100_000) {
    return [{ id: 'edit-0', from: base, to: base + a.join('').length, before: a.join(''), after: b.join(''), state: 'pending', conflict: false }]
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  }
  const result: AiEdit[] = []
  let i = 0, j = 0, position = base, edit: AiEdit | null = null
  const flush = () => { if (edit) result.push(edit); edit = null }
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); position += a[i].length; i++; j++; continue }
    edit ??= { id: 'edit-' + result.length, from: position, to: position, before: '', after: '', state: 'pending', conflict: false }
    if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) {
      edit.before += a[i]; position += a[i].length; edit.to = position; i++
    } else { edit.after += b[j]; j++ }
  }
  flush()
  return result
}

export function applyAiEdits(source: string, edits: AiEdit[]): { content: string; changes: ChangeSet } {
  const pending = edits.filter(edit => edit.state === 'pending').sort((a, b) => a.from - b.from)
  let end = -1
  for (const edit of pending) {
    if (edit.conflict || edit.from < end || edit.from < 0 || edit.to > source.length || source.slice(edit.from, edit.to) !== edit.before) {
      throw new Error('目标正文已变化，请检查冲突或重新生成。')
    }
    end = edit.to
  }
  const changes = ChangeSet.of(pending.map(edit => ({ from: edit.from, to: edit.to, insert: edit.after })), source.length)
  // ChangeSet uses UTF-16 positions, like CodeMirror and the stored selection.
  let content = source
  for (const edit of [...pending].reverse()) content = content.slice(0, edit.from) + edit.after + content.slice(edit.to)
  return { content, changes }
}
