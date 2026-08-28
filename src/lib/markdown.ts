const WIKI_LINK = /\[\[([^[\]]+)\]\]/g

export function wikiTargets(markdown: string) {
  return [...markdown.matchAll(WIKI_LINK)].map((match) => match[1].trim()).filter(Boolean)
}

export function highlightWikiLinks(markdown: string) {
  return markdown.replace(WIKI_LINK, '**[[$1]]**')
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
