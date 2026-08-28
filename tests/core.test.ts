import { describe, expect, it } from 'vitest'
import { convertPunctuation, wikiTargets, writingHints } from '../src/lib/markdown'
import { generateNames } from '../src/lib/name-generator'
import { countWords, debounce } from '../src/lib/utils'

describe('Markdown writing helpers', () => {
  it('extracts wiki targets without changing ordinary text', () => {
    expect(wikiTargets('她走进[[雾港]]，看见[[林月]]。')).toEqual(['雾港', '林月'])
  })

  it('reports potentially unsafe formatting without mutating content', () => {
    const source = '他说：“好”。,\n\n\n\n下一段  '
    expect(writingHints(source).map((hint) => hint.type)).toEqual(['punctuation', 'spacing', 'blank'])
    expect(convertPunctuation('你好,世界!', 'full')).toBe('你好，世界！')
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

  it('debounces repeated saves', async () => {
    let calls = 0
    const save = debounce(() => { calls += 1 }, 10)
    save(); save(); save()
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(calls).toBe(1)
  })
})
