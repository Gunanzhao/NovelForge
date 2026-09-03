import { describe, expect, it } from 'vitest'
import {
  applyMarkdownCommand, convertFullwidth, convertHalfwidth, convertPunctuation, parseFootnotes,
  wikiLinkHref, wikiMarkdown, wikiTargetFromHref, wikiTargets, writingHints,
} from '../src/lib/markdown'
import {
  categoryEntityKind, generateNames, readFavoriteNames, toggleFavoriteName, writeFavoriteNames,
} from '../src/lib/name-generator'
import { countWords, debounce } from '../src/lib/utils'

describe('Markdown writing helpers', () => {
  it('extracts wiki targets without changing ordinary text', () => {
    expect(wikiTargets('她走进[[雾港]]，看见[[林月]]。')).toEqual(['雾港', '林月'])
  })

  it('turns Wiki syntax into navigable links and leaves fenced code untouched', () => {
    const source = '她走进[[雾港]]。\n\n~~~md\n[[不是资料链接]]\n~~~'
    expect(wikiMarkdown(source)).toBe('她走进[雾港](' + wikiLinkHref('雾港') + ')。\n\n~~~md\n[[不是资料链接]]\n~~~')
    expect(wikiTargets(source)).toEqual(['雾港'])
    expect(wikiTargetFromHref(wikiLinkHref('雾港'))).toBe('雾港')
    expect(wikiTargetFromHref('https://example.com')).toBeNull()
  })

  it('reports potentially unsafe formatting without mutating content', () => {
    const source = '他说：“好”。,\n\n\n\n下一段  '
    expect(writingHints(source).map((hint) => hint.type)).toEqual(['punctuation', 'spacing', 'blank'])
    expect(convertPunctuation('你好,世界!', 'full')).toBe('你好，世界！')
  })

  it('converts character width without changing Markdown markers, code or URLs', () => {
    const tick = String.fromCharCode(96)
    const source = '**ABC123** ' + tick + 'ABC123' + tick + ' [链接](https://example.com/ABC123)\n\n~~~md\nABC123\n~~~\n中文 ABC123'
    expect(convertFullwidth(source)).toBe('**ＡＢＣ１２３** ' + tick + 'ABC123' + tick + ' [链接](https://example.com/ABC123)\n\n~~~md\nABC123\n~~~\n中文 ＡＢＣ１２３')
    expect(convertHalfwidth(convertFullwidth(source))).toBe(source)
  })

  it('converts the complete ASCII width range while preserving Markdown structure and destinations', () => {
    const half = [
      '---\ntitle: Frontmatter!@#\n---',
      'ABC123 !@#$%^&*() []{}<>?/\\|',
      '**ABC** *italic*',
      '# 标题',
      '- 列表',
      '1. 有序列表',
      '`!@# inline code`',
      '```md\n!@# fenced code\n```',
      'https://example.com/a?x=1&y=2',
      '[链接!](relative/path?q=1)',
      '![图片!](image.png)',
      '[[目标!]]',
      '正文[^note]。\n\n[^note]: 脚注!@#',
    ].join('\n')
    const full = convertFullwidth(half)
    expect(full).toContain('ＡＢＣ１２３ ！＠＃＄％＾＆＊（） ［］｛｝＜＞？／\\|')
    expect(full).toContain('**ＡＢＣ** *ｉｔａｌｉｃ*')
    expect(full).toContain('# 标题')
    expect(full).toContain('- 列表')
    expect(full).toContain('1. 有序列表')
    expect(full).toContain('`!@# inline code`')
    expect(full).toContain('```md\n!@# fenced code\n```')
    expect(full).toContain('https://example.com/a?x=1&y=2')
    expect(full).toContain('[链接！](relative/path?q=1)')
    expect(full).toContain('![图片！](image.png)')
    expect(full).toContain('[[目标!]]')
    expect(full).toContain('正文[^note]。')
    expect(full).toContain('[^note]: 脚注！＠＃')
    expect(full).toContain('---\ntitle: Frontmatter!@#\n---')
    expect(convertHalfwidth(full)).toBe(half)
    expect(convertFullwidth('中英 A B', { convertSpace: true })).toBe('中英　Ａ　Ｂ')
    expect(convertHalfwidth('中英　Ａ　Ｂ', { convertSpace: true })).toBe('中英 A B')
  })

  it('recognizes Chinese, named and repeated footnotes while ignoring code examples', () => {
    const tick = String.fromCharCode(96)
    const source = '正文[^1] 和正文[^note][^1]。\n\n[^1]: 中文说明\n[^note]: 命名说明\n\n' + tick + '[^code]' + tick + '\n\n```md\n[^fenced]: 不应被识别\n```'
    expect(parseFootnotes(source)).toEqual([
      { id: '1', definition: '中文说明', referenceCount: 2 },
      { id: 'note', definition: '命名说明', referenceCount: 1 },
    ])
  })

  it('applies inline commands to selected Unicode text and toggles them off', () => {
    const bold = applyMarkdownCommand('林月', 0, 2, 'bold')
    expect(bold.text).toBe('**林月**')
    expect(bold.selection).toEqual({ from: 2, to: 4 })
    const unbold = applyMarkdownCommand(bold.text, bold.selection.from, bold.selection.to, 'bold')
    expect(unbold.text).toBe('林月')
    expect(unbold.selection).toEqual({ from: 0, to: 2 })
  })

  it('inserts a selected placeholder at an empty cursor and formats multiple lines', () => {
    const placeholder = applyMarkdownCommand('前后', 1, 1, 'italic')
    expect(placeholder.text).toBe('前*文字*后')
    expect(placeholder.selection).toEqual({ from: 2, to: 4 })
    const quoted = applyMarkdownCommand('甲\n乙', 0, 3, 'quote')
    expect(quoted.text).toBe('> 甲\n> 乙')
    expect(quoted.selection).toEqual({ from: 0, to: 7 })
  })
})

describe('writing utilities', () => {
  it('counts Chinese and non-whitespace characters', () => {
    expect(countWords('# 标题\n\n雾港 来信')).toBe(7)
  })

  it('generates unique local names', () => {
    const names = generateNames('character', 8)
    expect(names).toHaveLength(8)
    expect(new Set(names).size).toBe(names.length)
  })

  it('supports generator categories, styles and favorite persistence', () => {
    expect(generateNames('planet', 4, '科幻')).toHaveLength(4)
    expect(generateNames('character', 4, '欧美').every((name) => /[A-Za-z]/u.test(name))).toBe(true)
    expect(categoryEntityKind('weapon')).toBe('world')
    const favorite = { name: '雾港', category: 'location' as const, style: '中文现代' as const, createdAt: '2026-01-01' }
    writeFavoriteNames([favorite])
    expect(readFavoriteNames()).toEqual([favorite])
    expect(toggleFavoriteName([favorite], favorite)).toEqual([])
  })

  it('debounces repeated saves', async () => {
    let calls = 0
    const save = debounce(() => { calls += 1 }, 10)
    save(); save(); save()
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(calls).toBe(1)
  })
})
