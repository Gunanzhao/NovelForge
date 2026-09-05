import { describe, expect, it } from 'vitest'
import { convertFullwidth, convertHalfwidth, wikiMarkdown, wikiRanges } from '../src/lib/markdown'
import { protectedMarkdownRanges } from '../src/lib/markdown-protected-ranges'

describe('shared Markdown protection', () => {
  it.each([
    '````md\nABC!\n```\nABC!\n~~~~\nABC!\n`````',
    '~~~~~\nABC!\n~~~~\nABC!\n~~~~~~',
    '``ABC! ` ABC! ``` ABC!``',
    '``ABC!\nABC!``',
    '[中文](relative/(ABC!)/file "title!)")',
    '![中文](relative/(ABC!)/file)',
    '[中文](<relative/(ABC!)/file>)',
    '[中文][ABC!]\n[ABC!]: relative/file',
    '[[ABC!]]',
    '<https://example.test/ABC!>',
    '`````md\nABC!',
  ])('preserves protected syntax byte-for-byte: %s', (protectedText) => {
    const source = `ABC!\n${protectedText}`
    expect(convertFullwidth(source)).toBe(`ＡＢＣ！\n${protectedText}`)
    expect(convertHalfwidth(convertFullwidth(source))).toBe(source)
  })

  it('preserves frontmatter only at the start of the document', () => {
    const metadata = '---\ntitle: ABC!\n---\n'
    expect(convertFullwidth(metadata + 'ABC!')).toBe(metadata + 'ＡＢＣ！')
    expect(convertFullwidth('ABC!\n' + metadata)).toBe('ＡＢＣ！\n---\nｔｉｔｌｅ： ＡＢＣ！\n---\n')
  })

  it('shares code and destination exclusions with Wiki rendering, preserving UTF-16 offsets', () => {
    const source = [
      '😀[[林月]][[雾港]]',
      '````md', '[[隐藏]]', '```', '[[仍隐藏]]', '`````',
      '``[[行内]] ` [[仍行内]]``',
      '[正文](relative/[[目标]])',
      '[[星辉魔法]]',
    ].join('\r\n')
    const ranges = wikiRanges(source)
    expect(ranges.map((range) => range.target)).toEqual(['林月', '雾港', '星辉魔法'])
    expect(ranges[0].from).toBe(2)
    for (const range of ranges) expect(source.slice(range.from, range.to)).toBe(`[[${range.target}]]`)
    expect(wikiMarkdown(source)).toContain('``[[行内]] ` [[仍行内]]``')
    expect(wikiMarkdown(source)).toContain('[正文](relative/[[目标]])')
  })

  it('returns merged, ordered ranges and does not treat an unmatched inline delimiter as code', () => {
    const source = '` unmatched ABC!\n[[ABC!]] `code`'
    const ranges = protectedMarkdownRanges(source)
    for (let i = 1; i < ranges.length; i += 1) expect(ranges[i].start).toBeGreaterThan(ranges[i - 1].end)
    expect(convertFullwidth('`` unmatched ABC!')).toBe('`` ｕｎｍａｔｃｈｅｄ ＡＢＣ！')
  })
})
