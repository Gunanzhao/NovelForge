import { ChangeSet } from '@codemirror/state'
/** HTML textareas and CodeMirror normalize CRLF/CR to LF; translate their selection to original UTF-16 offsets. */
export function sourceRangeFromNormalizedText(source: string, from: number, to: number): { from: number; to: number } {
  let normalized = 0, start = -1, end = -1
  for (let offset = 0; offset <= source.length; offset++) {
    if (normalized === from && start < 0) start = offset
    if (normalized === to) { end = offset; break }
    if (source[offset] === '\r' && source[offset + 1] === '\n') offset++
    normalized++
  }
  if (start < 0 || end < start) throw new Error('原文选区无效，请重新选择。')
  return { from: start, to: end }
}

export const normalizeLineBreaks = (source: string): string => source.replace(/\r\n?/gu, '\n')
export function normalizedRangeFromSource(source: string, from: number, to: number) {
  return { from: normalizeLineBreaks(source.slice(0, from)).length, to: normalizeLineBreaks(source.slice(0, to)).length }
}

/** An exact source-to-editor change map; formatting-only CR removal is tracked separately from edits. */
export function newlineNormalizationChanges(source: string): ChangeSet {
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let from = 0; from < source.length; from++) {
    if (source[from] === '\r') changes.push({ from, to: from + 1, insert: source[from + 1] === '\n' ? '' : '\n' })
  }
  return ChangeSet.of(changes, source.length, '\n')
}
export function editorChangesFromSource(source: string, changes: ChangeSet): ChangeSet {
  const normalization = newlineNormalizationChanges(source)
  const edits: Array<{ from: number; to: number; insert: string }> = []
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    edits.push({ from: normalization.mapPos(from, -1), to: normalization.mapPos(to, 1), insert: normalizeLineBreaks(inserted.toString()) })
  })
  return ChangeSet.of(edits, normalization.newLength, '\n')
}
