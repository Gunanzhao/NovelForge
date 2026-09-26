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
