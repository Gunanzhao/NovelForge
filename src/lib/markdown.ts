const WIKI_LINK = /\[\[([^[\]]+)\]\]/g
export const WIKI_LINK_HREF_PREFIX = 'novelforge-wiki:'

export interface WikiRange {
  from: number
  to: number
  target: string
}

/**
 * Locate Wiki links outside fenced code blocks.
 *
 * CodeMirror positions are UTF-16 offsets, which are also the offsets returned
 * by JavaScript string operations, so the ranges can be shared by the editor
 * decoration and preview renderer.
 */
export function wikiRanges(markdown: string): WikiRange[] {
  const ranges: WikiRange[] = []
  let offset = 0
  let fenced = false
  let fenceCharacter = ''
  const lines = markdown.split(/\r\n|\n|\r/u)

  for (const line of lines) {
    const fence = line.match(/^\s*(~{3,})/u) || line.match(new RegExp('^\\s*(' + String.fromCharCode(96) + '{3,})', 'u'))
    if (fence) {
      if (!fenced) {
        fenced = true
        fenceCharacter = fence[1][0]
      } else if (fence[1][0] === fenceCharacter) {
        fenced = false
        fenceCharacter = ''
      }
    } else if (!fenced) {
      for (const match of line.matchAll(WIKI_LINK)) {
        const target = match[1].trim()
        if (!target || match.index === undefined) continue
        ranges.push({
          from: offset + match.index,
          to: offset + match.index + match[0].length,
          target,
        })
      }
    }
    offset += line.length
    if (markdown.slice(offset, offset + 2) === '\r\n') offset += 2
    else if (markdown[offset] === '\r' || markdown[offset] === '\n') offset += 1
  }
  return ranges
}

export function wikiTargets(markdown: string) {
  return wikiRanges(markdown).map((range) => range.target)
}

export function wikiLinkHref(target: string) {
  return WIKI_LINK_HREF_PREFIX + encodeURIComponent(target.trim())
}

export function wikiTargetFromHref(href: string | undefined) {
  if (!href || !href.startsWith(WIKI_LINK_HREF_PREFIX)) return null
  try {
    const target = decodeURIComponent(href.slice(WIKI_LINK_HREF_PREFIX.length)).trim()
    return target || null
  } catch {
    return null
  }
}

/**
 * Convert the author-facing [[Target]] syntax to a normal Markdown link.
 * ReactMarkdown can then render it with its regular link pipeline while the
 * application handles the private href scheme as an in-app navigation event.
 */
export function wikiMarkdown(markdown: string) {
  const ranges = wikiRanges(markdown)
  if (!ranges.length) return markdown
  let cursor = 0
  let result = ''
  for (const range of ranges) {
    const label = markdown.slice(range.from + 2, range.to - 2).trim()
    result += markdown.slice(cursor, range.from) + '[' + label + '](' + wikiLinkHref(range.target) + ')'
    cursor = range.to
  }
  return result + markdown.slice(cursor)
}

export function highlightWikiLinks(markdown: string) {
  return markdown.replace(WIKI_LINK, '**[[$1]]**')
}

export type MarkdownCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'heading'
  | 'quote'
  | 'unordered-list'
  | 'ordered-list'
  | 'task-list'
  | 'link'
  | 'image'
  | 'horizontal-rule'

export interface MarkdownCommandResult {
  text: string
  selection: { from: number; to: number }
}

function replaceRange(source: string, from: number, to: number, replacement: string, selection = { from, to: from + replacement.length }): MarkdownCommandResult {
  return {
    text: source.slice(0, from) + replacement + source.slice(to),
    selection,
  }
}

function toggleInline(source: string, from: number, to: number, marker: string): MarkdownCommandResult {
  const selected = source.slice(from, to)
  const before = source.slice(Math.max(0, from - marker.length), from)
  const after = source.slice(to, to + marker.length)
  if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(marker.length, -marker.length)
    return replaceRange(source, from, to, inner, { from, to: from + inner.length })
  }
  if (before === marker && after === marker) {
    return replaceRange(source, from - marker.length, to + marker.length, selected, { from: from - marker.length, to: to - marker.length })
  }
  const inner = selected || '文字'
  const replacement = marker + inner + marker
  const innerStart = from + marker.length
  return replaceRange(source, from, to, replacement, {
    from: innerStart,
    to: innerStart + inner.length,
  })
}

function lineCommand(source: string, from: number, to: number, prefix: string): MarkdownCommandResult {
  const lineStart = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const nextBreak = source.indexOf('\n', to)
  const lineEnd = nextBreak === -1 ? source.length : nextBreak
  const selected = source.slice(lineStart, lineEnd)
  const lines = selected.split('\n')
  const shouldRemove = lines.every((line) => line.startsWith(prefix))
  const replacement = lines.map((line) => shouldRemove ? line.slice(prefix.length) : prefix + line).join('\n')
  return replaceRange(source, lineStart, lineEnd, replacement, {
    from: lineStart,
    to: lineStart + replacement.length,
  })
}

function orderedListCommand(source: string, from: number, to: number): MarkdownCommandResult {
  const lineStart = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const nextBreak = source.indexOf('\n', to)
  const lineEnd = nextBreak === -1 ? source.length : nextBreak
  const selected = source.slice(lineStart, lineEnd)
  const lines = selected.split('\n')
  const shouldRemove = lines.every((line) => /^\d+[.)]\s/u.test(line))
  const replacement = lines.map((line, index) => shouldRemove ? line.replace(/^\d+[.)]\s/u, '') : String(index + 1) + '. ' + line).join('\n')
  return replaceRange(source, lineStart, lineEnd, replacement, {
    from: lineStart,
    to: lineStart + replacement.length,
  })
}

function linkCommand(source: string, from: number, to: number, image: boolean): MarkdownCommandResult {
  const selected = source.slice(from, to) || (image ? '图片描述' : '文字')
  const replacement = (image ? '![' : '[') + selected + '](链接地址)'
  const targetStart = from + (image ? 2 : 1) + selected.length + 2
  return replaceRange(source, from, to, replacement, {
    from: targetStart,
    to: targetStart + 4,
  })
}

export function applyMarkdownCommand(source: string, from: number, to: number, command: MarkdownCommand): MarkdownCommandResult {
  const safeFrom = Math.max(0, Math.min(from, source.length))
  const safeTo = Math.max(safeFrom, Math.min(to, source.length))
  switch (command) {
    case 'bold':
      return toggleInline(source, safeFrom, safeTo, '**')
    case 'italic':
      return toggleInline(source, safeFrom, safeTo, '*')
    case 'strikethrough':
      return toggleInline(source, safeFrom, safeTo, '~~')
    case 'code':
      return toggleInline(source, safeFrom, safeTo, String.fromCharCode(96))
    case 'heading':
      return lineCommand(source, safeFrom, safeTo, '# ')
    case 'quote':
      return lineCommand(source, safeFrom, safeTo, '> ')
    case 'unordered-list':
      return lineCommand(source, safeFrom, safeTo, '- ')
    case 'task-list':
      return lineCommand(source, safeFrom, safeTo, '- [ ] ')
    case 'ordered-list':
      return orderedListCommand(source, safeFrom, safeTo)
    case 'link':
      return linkCommand(source, safeFrom, safeTo, false)
    case 'image':
      return linkCommand(source, safeFrom, safeTo, true)
    case 'horizontal-rule':
      return replaceRange(source, safeFrom, safeTo, '\n---\n', { from: safeFrom + 5, to: safeFrom + 5 })
  }
}

export interface WritingHint {
  type: 'punctuation' | 'spacing' | 'blank'
  line: number
  message: string
  sample: string
}

export function writingHints(markdown: string): WritingHint[] {
  const hints: WritingHint[] = []
  const lines = markdown.split(/\r?\n/u)
  lines.forEach((line, index) => {
    if (/[，。！？；：、][,.;:!?]/u.test(line)) {
      hints.push({ type: 'punctuation', line: index + 1, message: '中英文标点连续出现，请确认是否需要保留。', sample: line.trim() })
    }
    if (/[A-Za-z] {2,}[A-Za-z]/u.test(line)) {
      hints.push({ type: 'spacing', line: index + 1, message: '英文单词之间出现多余空格。', sample: line.trim() })
    }
    if (line.length > 0 && /\s+$/u.test(line)) {
      hints.push({ type: 'spacing', line: index + 1, message: '行尾存在多余空格。', sample: line.trim() })
    }
  })
  if (/\n{4,}/u.test(markdown)) {
    hints.push({ type: 'blank', line: 1, message: '文档中存在连续空白行。清理前请先确认排版意图。', sample: '连续空白行' })
  }
  return hints.slice(0, 50)
}

export function convertPunctuation(markdown: string, direction: 'full' | 'half') {
  if (direction === 'full') {
    return markdown.replace(/,/g, '，').replace(/\./g, '。').replace(/\?/g, '？').replace(/!/g, '！').replace(/:/g, '：').replace(/;/g, '；')
  }
  return markdown.replace(/，/g, ',').replace(/。/g, '.').replace(/？/g, '?').replace(/！/g, '!').replace(/：/g, ':').replace(/；/g, ';')
}

export interface WidthConversionOptions {
  convertSpace?: boolean
}

interface ProtectedWidthRange {
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

function protectWidthSensitiveSegments(markdown: string) {
  const ranges: ProtectedWidthRange[] = []
  const protect = (start: number, end: number) => {
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end })
  }

  // YAML frontmatter is metadata, not manuscript prose.
  const frontmatter = markdown.match(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u)
  if (frontmatter) protect(0, frontmatter[0].length)

  // Protect fenced blocks with a matching fence character and length. This
  // avoids the old regex pairing a ``` opener with a ~~~ closer.
  const lines = markdown.split(/\r\n|\n|\r/u)
  let lineStart = 0
  let activeFence: { start: number; character: string; length: number } | null = null
  for (const line of lines) {
    const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)
    if (!activeFence && fence) {
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
  forEachRegexMatch(markdown, /(`+)[^\r\n]*?\1/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /\b(?:https?|ftp):\/\/[^\s<>{}\x5b\x5d"']+/giu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /<(?:https?|ftp|mailto):[^>\r\n]+>/giu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /<!--[\s\S]*?-->|<\/?[A-Za-z][^>\r\n]*>/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /&(?:#\d+|#x[\da-f]+|[A-Za-z][A-Za-z\d]+);/giu, (match) => protect(match.index, match.index + match[0].length))

  // Wiki links and footnote identifiers are Markdown-adjacent syntax. Their
  // visible definitions remain convertible, but delimiters and IDs do not.
  forEachRegexMatch(markdown, /\[\[[^\]\r\n]+\]\]/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /\[\^[^\]\s]+\]\s*:/gu, (match) => protect(match.index, match.index + match[0].length))
  forEachRegexMatch(markdown, /\[\^[^\]\s]+\]/gu, (match) => protect(match.index, match.index + match[0].length))

  // Preserve link/image destinations and their structural parentheses while
  // still allowing punctuation in the visible label/alt text to convert.
  forEachRegexMatch(markdown, /!?\[[^\]\r\n]*\]\((?:<[^>\r\n]*>|[^)\r\n]*)\)/gu, (match) => {
    const full = match[0]
    const labelOpen = full.indexOf('[')
    const labelClose = full.indexOf(']', labelOpen + 1)
    if (labelOpen < 0 || labelClose < 0) return
    if (full.startsWith('!')) protect(match.index, match.index + 1)
    protect(match.index + labelOpen, match.index + labelOpen + 1)
    protect(match.index + labelClose, match.index + labelClose + 1)
    protect(match.index + labelClose + 1, match.index + full.length)
  })
  forEachRegexMatch(markdown, /!?\[[^\]\r\n]*\]\[[^\]\r\n]*\]/gu, (match) => {
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

  // Merge overlaps before replacing with private-use placeholders. Two
  // private-use code points encode each segment index, avoiding the previous
  // 640-segment limit while keeping placeholders immune to width conversion.
  ranges.sort((left, right) => left.start - right.start || right.end - left.end)
  const merged: ProtectedWidthRange[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  const protectedSegments: string[] = []
  let cursor = 0
  let source = ''
  for (const range of merged) {
    source += markdown.slice(cursor, range.start)
    const index = protectedSegments.push(markdown.slice(range.start, range.end)) - 1
    source += '\uE000' + String.fromCodePoint(0xE100 + (index >> 8), 0xE100 + (index & 0xff)) + '\uE001'
    cursor = range.end
  }
  source += markdown.slice(cursor)
  return { source, protectedSegments }
}

function convertWidthCharacter(character: string, direction: 'full' | 'half', convertSpace: boolean) {
  const codePoint = character.codePointAt(0) ?? 0
  if (direction === 'full' && codePoint >= 0x21 && codePoint <= 0x7e) {
    return String.fromCodePoint(codePoint + 0xfee0)
  }
  if (direction === 'half' && codePoint >= 0xff01 && codePoint <= 0xff5e) {
    return String.fromCodePoint(codePoint - 0xfee0)
  }
  if (convertSpace && direction === 'full' && character === ' ') return '\u3000'
  if (convertSpace && direction === 'half' && character === '\u3000') return ' '
  return character
}

export function convertWidth(markdown: string, direction: 'full' | 'half', options: WidthConversionOptions = {}) {
  const { source, protectedSegments } = protectWidthSensitiveSegments(markdown)
  const converted = Array.from(source, (character) => convertWidthCharacter(character, direction, options.convertSpace === true)).join('')
  return converted.replace(/\uE000([\uE100-\uE1FF])([\uE100-\uE1FF])\uE001/gu, (_match, high: string, low: string) => {
    const index = (((high.codePointAt(0) ?? 0) - 0xE100) << 8) + ((low.codePointAt(0) ?? 0) - 0xE100)
    return protectedSegments[index] ?? ''
  })
}

export function convertFullwidth(markdown: string, options?: WidthConversionOptions) {
  return convertWidth(markdown, 'full', options)
}

export function convertHalfwidth(markdown: string, options?: WidthConversionOptions) {
  return convertWidth(markdown, 'half', options)
}

export interface FootnoteInfo {
  id: string
  definition: string
  referenceCount: number
}

export function parseFootnotes(markdown: string): FootnoteInfo[] {
  const definitions = new Map<string, string>()
  const references = new Map<string, number>()
  let fenced = false
  let fenceCharacter = ''
  const lines = markdown.split(/\r\n|\n|\r/u)
  for (const line of lines) {
    const fence = line.match(/^\s*(~{3,})/u) || line.match(new RegExp('^\\s*(' + String.fromCharCode(96) + '{3,})', 'u'))
    if (fence) {
      if (!fenced) {
        fenced = true
        fenceCharacter = fence[1][0]
      } else if (fence[1][0] === fenceCharacter) {
        fenced = false
        fenceCharacter = ''
      }
      continue
    }
    if (fenced) continue
    const definition = line.match(/^\s*\[\^([^\]\s]+)\]:\s*(.*)$/u)
    if (definition) {
      definitions.set(definition[1], definition[2])
      continue
    }
    const withoutCode = line.replace(new RegExp(String.fromCharCode(96) + '[^' + String.fromCharCode(96) + '\\n]*' + String.fromCharCode(96), 'gu'), '')
    for (const reference of withoutCode.matchAll(/\[\^([^\]\s]+)\]/gu)) {
      const id = reference[1]
      references.set(id, (references.get(id) ?? 0) + 1)
    }
  }
  const ids = new Set([...definitions.keys(), ...references.keys()])
  return [...ids].map((id) => ({ id, definition: definitions.get(id) ?? '', referenceCount: references.get(id) ?? 0 }))
}

export function cleanWritingWhitespace(markdown: string) {
  return markdown
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
}

export function indentParagraphs(markdown: string) {
  const lines = markdown.split(/\r?\n/u)
  let inFence = false
  let paragraphStart = true
  return lines.map((line) => {
    const trimmed = line.trim()
    if (/^\x60{3}/u.test(trimmed)) {
      inFence = !inFence
      paragraphStart = false
      return line
    }
    if (!trimmed) {
      paragraphStart = true
      return line
    }
    const markdownBlock = /^(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|\|)/u.test(trimmed)
    const next = !inFence && paragraphStart && !markdownBlock && !line.startsWith('　　')
      ? '　　' + line
      : line
    paragraphStart = false
    return next
  }).join('\n')
}
