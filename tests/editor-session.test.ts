import { expect, it } from 'vitest'
import { clampEditorPosition, readEditorSession, rememberEditor } from '../src/lib/editor-session'
it('keeps distinct chapter positions across revisits and normalizes Windows paths', () => {
  const p = { anchor: 12, head: 30, scrollTop: 450, scrollLeft: 0 }
  rememberEditor('E:/位置测试', 'a', p); rememberEditor('E:/位置测试', 'b'); rememberEditor('e:/位置测试', 'a')
  expect(readEditorSession('e:/位置测试')).toEqual({ nodeId: 'a', positions: { a: p } })
  expect(readEditorSession('E:/其他项目').nodeId).toBe('')
})
it('clamps stale positions and rejects invalid stored numbers', () => {
  expect(clampEditorPosition({ anchor: 90, head: -5, scrollTop: Infinity, scrollLeft: NaN }, 20)).toEqual({ anchor: 20, head: 0, scrollTop: 0, scrollLeft: 0 })
})
