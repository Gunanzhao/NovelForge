export interface SearchSegment {
  text: string
  match: boolean
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^()|[\]\\]/gu, '\\$&').replace(/[$]/gu, '\\$&')
}

export function findSearchMatch(content: string, query: string, snippet: string, caseSensitive = false) {
  const phrase = query.trim()
  if (!phrase) return null
  const terms = phrase.split(/\s+/u).map(term => term.replace(/"/gu, '')).filter(Boolean)
  const pattern = new RegExp([phrase, ...terms].map(escapeRegExp).join('|'), caseSensitive ? 'u' : 'iu')
  const preview = snippet.replace(/<\/?mark>/gu, '').replace(/^…|…$/gu, '')
  if (preview) {
    // Prefer the occurrence from the result card, even when a term repeats.
    // The plain-text backend snippet can replace newlines with spaces.
    const offset = content.indexOf(preview)
    const previewOffset = offset >= 0 ? offset : content.replace(/\n/gu, ' ').indexOf(preview)
    const match = previewOffset >= 0 ? pattern.exec(preview) : null
    if (match) return { from: previewOffset + match.index, to: previewOffset + match.index + match[0].length }
  }
  const match = new RegExp(escapeRegExp(phrase), caseSensitive ? 'u' : 'iu').exec(content) ?? pattern.exec(content)
  return match ? { from: match.index, to: match.index + match[0].length } : null
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
