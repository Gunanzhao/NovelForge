const WIKI_LINK = /\[\[([^[\]]+)\]\]/g

export function wikiTargets(markdown: string) {
  return [...markdown.matchAll(WIKI_LINK)].map((match) => match[1].trim()).filter(Boolean)
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
