import { describe, expect, it } from 'vitest'
import { diffLines } from '../src/lib/text-diff'

describe('history text diff', () => {
  it('marks changed lines while preserving common lines', () => {
    expect(diffLines('第一行\n旧内容', '第一行\n新内容')).toEqual([
      { kind: 'same', text: '第一行' },
      { kind: 'removed', text: '旧内容' },
      { kind: 'added', text: '新内容' },
    ])
  })

  it('uses a safe coarse diff for very large revisions', () => {
    const result = diffLines('a\n'.repeat(801), 'b\n'.repeat(801))
    expect(result.every((line) => line.kind !== 'same')).toBe(true)
  })
})
