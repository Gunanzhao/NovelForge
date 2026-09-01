import { describe, expect, it, vi } from 'vitest'
import {
  deleteTextControlSelection, replaceTextControlSelection, textControlSelection,
  writeClipboardText,
} from '../src/lib/clipboard'

describe('clipboard helpers', () => {
  it('replaces and deletes a controlled text selection while dispatching input events', () => {
    const target = document.createElement('textarea')
    target.value = '甲乙丙'
    document.body.appendChild(target)
    target.setSelectionRange(1, 2)
    const events: string[] = []
    target.addEventListener('input', (event) => events.push((event as InputEvent).inputType))
    replaceTextControlSelection(target, '新')
    expect(target.value).toBe('甲新丙')
    expect(textControlSelection(target).text).toBe('')
    target.setSelectionRange(1, 2)
    deleteTextControlSelection(target)
    expect(target.value).toBe('甲丙')
    expect(events).toEqual(['insertFromPaste', 'deleteByCut'])
    target.remove()
  })

  it('does not report clipboard success when both browser and editing commands fail', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(false) })
    await expect(writeClipboardText('不可复制')).resolves.toBe(false)
  })
})
