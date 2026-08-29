export interface SearchSegment {
  text: string
  match: boolean
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^()|[\]\\]/gu, '\\$&').replace(/[$]/gu, '\\$&')
}

export function searchSegments(value: string, query: string, caseSensitive = false): SearchSegment[] {
  const plain = value.replace(/<\/?mark>/gu, '')
  const terms = query.trim().split(/\s+/u).filter(Boolean).map(escapeRegExp)
  if (!terms.length) return [{ text: plain, match: false }]
  const expression = new RegExp(terms.join('|'), 'gu' + (caseSensitive ? '' : 'i'))
  const segments: SearchSegment[] = []
  let cursor = 0
  for (const match of plain.matchAll(expression)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ text: plain.slice(cursor, index), match: false })
    segments.push({ text: match[0], match: true })
    cursor = index + match[0].length
  }
  if (cursor < plain.length || !segments.length) segments.push({ text: plain.slice(cursor), match: false })
  return segments
}
