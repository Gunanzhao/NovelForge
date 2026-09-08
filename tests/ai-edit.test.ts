import { ChangeSet } from '@codemirror/state'
import { expect, it } from 'vitest'
import { aiEdits, applyAiEdits, mapAiRange, textChanges } from '../src/lib/ai-edit'

it('reconstructs Chinese, emoji, insertions, deletions and long passages exactly', () => {
  for (const [before, after] of [['雨夜。风很冷。', '雨夜。风很轻。灯亮了。'], ['😀甲乙', '😃甲丙'], ['', '新段落'], ['删除', ''], ['同一段。'.repeat(1000), '变化一。'.repeat(1000)]]) {
    expect(applyAiEdits('前' + before + '后', aiEdits(before, after, 1)).content).toBe('前' + after + '后')
  }
})
it('supports accepting or rejecting individual edits without replacing unchanged text', () => {
  const source = '甲：风很冷。乙：灯很暗。'
  const edits = aiEdits(source, '甲：风很暖。乙：灯很亮。')
  expect(edits.length).toBe(2)
  const first = applyAiEdits(source, [edits[0]])
  const second = { ...edits[1], ...mapAiRange(edits[1], first.changes) }
  expect(applyAiEdits(first.content, [second]).content).toBe('甲：风很暖。乙：灯很亮。')
  expect(applyAiEdits(source, [{ ...edits[0], state: 'rejected' }, edits[1]]).content).toBe('甲：风很冷。乙：灯很亮。')
})
it('maps unrelated changes, conservatively detects overlap and tracks an insertion anchor', () => {
  const target = { from: 3, to: 6, conflict: false }
  expect(mapAiRange(target, ChangeSet.of({ from: 0, insert: '开头' }, 10))).toEqual({ from: 5, to: 8, conflict: false })
  expect(mapAiRange(target, ChangeSet.of({ from: 4, to: 5, insert: '改' }, 10)).conflict).toBe(true)
  expect(mapAiRange(target, ChangeSet.of({ from: 3, insert: '外' }, 10))).toEqual({ from: 4, to: 7, conflict: false })
  expect(mapAiRange({ from: 3, to: 3, conflict: false }, ChangeSet.of({ from: 3, insert: '用户' }, 10)).conflict).toBe(true)
})
it('rejects stale or overlapping edits and preserves Unicode fallback mapping', () => {
  expect(() => applyAiEdits('已修改', aiEdits('原正文', '新正文'))).toThrow('正文已变化')
  const changes = textChanges('前😀后', '前😃后')
  const range = mapAiRange({ from: 1, to: 3, conflict: false }, changes)
  expect(range).toEqual({ from: 1, to: 3, conflict: true })
  expect(textChanges('相同', '相同').empty).toBe(true)
})
