export interface MarkdownProtectedRange {
  start: number
  end: number
}

function forEachRegexMatch(source: string, expression: RegExp, callback: (match: RegExpExecArray) => void) {
  expression.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = expression.exec(source))) {
    callback(match)
    if (!match[0]) expression.lastIndex += 1
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function isWordLike(value: string | undefined) {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value))
}

/** Shared UTF-16 exclusions for prose scanning, Wiki rendering and width conversion. */
export function protectedMarkdownRanges(markdown: string, protectWiki = true) {
  const ranges: MarkdownProtectedRange[] = []
  const protect = (start: number, end: number) => {
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end })
  }

  // YAML frontmatter is metadata, not manuscript prose.
  const frontmatter = markdown.match(/^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/u)
  if (frontmatter) protect(0, frontmatter[0].length)

  // Protect fenced blocks with a matching fence character and length. This
  // avoids the old regex pairing a ``` opener with a ~~~ closer.
  const lines = markdown.split(/\r\n|\n|\r/u)
  let lineStart = 0
  let activeFence: { start: number; character: string; length: number } | null = null
  for (const line of lines) {
    const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)
    if (frontmatter && lineStart < frontmatter[0].length) {
      // Metadata cannot open a manuscript code fence.
    } else if (!activeFence && fence && !(fence[1][0] === '`' && line.slice(fence[0].length).includes('`'))) {
      activeFence = { start: lineStart, character: fence[1][0], length: fence[1].length }
    } else if (activeFence) {
      const closing = new RegExp('^[ \\t]{0,3}' + escapeRegExp(activeFence.character) + '{' + String(activeFence.length) + ',}[ \\t]*$', 'u')
      if (closing.test(line)) {
        protect(activeFence.start, lineStart + line.length)
        activeFence = null
      }
    }
    const lineEnd = lineStart + line.length
    const breakLength = markdown.startsWith('\r\n', lineEnd) ? 2 : markdown[lineEnd] ? 1 : 0
    lineStart = lineEnd + breakLength
  }
  if (activeFence) protect(activeFence.start, markdown.length)

  // Inline code, URLs, autolinks, HTML tags and entities must survive the
  // character pass byte-for-byte.
  const blocks = ranges.slice().sort((a, b) => a.start - b.start)
  let proseStart = 0
  for (const block of [...blocks, { start: markdown.length, end: markdown.length }]) {
    const runs = [...markdown.slice(proseStart, block.start).matchAll(/`+/gu)]
    const nextRun = new Map<number, number>()
    const closers = new Map<number, number>()
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const next = nextRun.get(runs[i][0].length)
      if (next !== undefined) closers.set(i, next)
      nextRun.set(runs[i][0].length, i)
    }
    for (let i = 0; i < runs.length; i += 1) {
      const opener = runs[i]
      const start = proseStart + opener.index
      let slashes = 0
      for (let j = start - 1; j >= 0 && markdown[j] === '\\'; j -= 1) slashes += 1
      if (slashes % 2) continue
      const closer = closers.get(i)
      if (closer === undefined) continue
      protect(start, proseStart + runs[closer].index + runs[closer][0].length)
      i = closer
    }
    proseStart = Math.max(proseStart, block.end)
  }
  forEachRegexMatch(markdown, /\b(?:https?|ftp):\/\/[^\s<>{}\x5b\x5d"']+/giu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /<(?:https?|ftp|mailto):[^>\r\n]+>/giu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /<!--[\s\S]*?-->|<\/?[A-Za-z][^>\r\n]*>/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /&(?:#\d+|#x[\da-f]+|[A-Za-z][A-Za-z\d]+);/giu, (match) => protect(match.index, match.index + match[0].length))

  forEachRegexMatch(markdown, /\bmailto:[^\s<>]+/giu, (match) => protect(match.index, match.index + match[0].length))

  // Wiki links and footnote identifiers are Markdown-adjacent syntax. Their
  // visible definitions remain convertible, but delimiters and IDs do not.
  if (protectWiki) forEachRegexMatch(markdown, /\[\[[^[\]\r\n]+\]\]/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /\[\^[^\]\s]+\]\s*:/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /\[\^[^\]\s]+\]/gu, (match) => protect(match.index, match.index + match[0].length))

  // Preserve link/image destinations and their structural parentheses while
  // still allowing punctuation in the visible label/alt text to convert.
  forEachRegexMatch(markdown, /(?<!\[)!?\[(?!\[)[^\]\r\n]*\]\(/gu, (match) => {
    const full = match[0]
    const labelOpen = full.indexOf('[')
    const labelClose = full.indexOf(']', labelOpen + 1)
    const opening = match.index + full.length - 1
    let depth = 1
    let angle = false
    let quote = ''
    let end = opening + 1
    for (; end < markdown.length; end += 1) {
      const character = markdown[end]
      if (character === '\\') { end += 1; continue }
      if (character === '\r' || character === '\n') break
      if (quote) { if (character === quote) quote = ''; continue }
      if (angle) { if (character === '>') angle = false; continue }
      if (character === '<') { angle = true; continue }
      if ((character === '"' || character === "'") && /\s/u.test(markdown[end - 1])) { quote = character; continue }
      if (character === '(') depth += 1
      if (character === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) return
    if (full.startsWith('!')) protect(match.index, match.index + 1)
    protect(match.index + labelOpen, match.index + labelOpen + 1)
    protect(match.index + labelClose, match.index + labelClose + 1)
    protect(opening, end + 1)
  })
  forEachRegexMatch(markdown, /(?<!\[)!?\[(?!\[)[^\]\r\n]*\]\[[^\]\r\n]*\]/gu, (match) => {
    const full = match[0]
    const labelOpen = full.indexOf('[')
    const labelClose = full.indexOf(']', labelOpen + 1)
    if (labelOpen < 0 || labelClose < 0) return
    if (full.startsWith('!')) protect(match.index, match.index + 1)
    protect(match.index + labelOpen, match.index + labelOpen + 1)
    protect(match.index + labelClose, match.index + labelClose + 1)
    protect(match.index + labelClose + 1, match.index + full.length)
  })

  // Markdown escapes and backticks remain escapes/markers after conversion.
  forEachRegexMatch(markdown, /\\[!-~]/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /`/gu, (match) => protect(match.index, match.index + 1))
  forEachRegexMatch(markdown, /(?:\*{2,}|_{2,}|~{2,})/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /[*_]/gu, (match) => {
    const previous = markdown[match.index - 1]
    const next = markdown[match.index + 1]
    if (isWordLike(previous) || isWordLike(next)) protect(match.index, match.index + 1)
  })

  // Line-oriented block syntax: headings, blockquotes, lists, thematic
  // breaks, reference definitions and table separators.
  lineStart = 0
  for (const line of lines) {
    const heading = line.match(/^[ \t]{0,3}(#{1,6})(?=\s|$)/u)
    if (heading) {
      const markerStart = line.indexOf(heading[1])
      protect(lineStart + markerStart, lineStart + markerStart + heading[1].length)
    }
    const quote = line.match(/^[ \t]{0,3}(>)(?=\s|$)/u)
    if (quote) {
      const markerStart = line.indexOf('>')
      protect(lineStart + markerStart, lineStart + markerStart + 1)
    }
    const unordered = line.match(/^[ \t]{0,3}([-+*])(?=\s+)/u)
    if (unordered) {
      const markerStart = line.indexOf(unordered[1])
      protect(lineStart + markerStart, lineStart + markerStart + 1)
    }
    const ordered = line.match(/^[ \t]{0,3}(\d{1,9}[.)])(?=\s+)/u)
    if (ordered) {
      const markerStart = line.indexOf(ordered[1])
      protect(lineStart + markerStart, lineStart + markerStart + ordered[1].length)
    }
    if (/^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u.test(line)) {
      protect(lineStart, lineStart + line.length)
    }
    if (/^[ \t]{0,3}\[[^\]\r\n]+\]:\s*\S+/u.test(line) && !/^\s*\[\^[^\]]+\]:/u.test(line)) {
      protect(lineStart, lineStart + line.length)
    }
    if (line.includes('|') && (line.trim().startsWith('|') || line.trim().endsWith('|') || /^[\s:|-]+$/u.test(line))) {
      for (let offset = 0; offset < line.length; offset += 1) {
        if (line[offset] === '|') protect(lineStart + offset, lineStart + offset + 1)
      }
    }
    const lineEnd = lineStart + line.length
    const breakLength = markdown.startsWith('\r\n', lineEnd) ? 2 : markdown[lineEnd] ? 1 : 0
    lineStart = lineEnd + breakLength
  }

  // Merge overlaps so consumers can traverse protected spans in source order.
  ranges.sort((left, right) => left.start - right.start || right.end - left.end)
  const merged: MarkdownProtectedRange[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}
