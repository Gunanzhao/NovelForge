export type TextControl = HTMLInputElement | HTMLTextAreaElement

export interface ClipboardReadResult {
  ok: boolean
  text?: string
  nativeApplied?: boolean
}

function canUseClipboardApi() {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard)
}

function selectionRange(target: TextControl) {
  const start = target.selectionStart
  const end = target.selectionEnd
  if (start === null || end === null) return { start: 0, end: target.value.length }
  return { start, end }
}

function dispatchInput(target: TextControl, inputType: string, data: string | null) {
  target.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType,
    data,
  }))
}

async function fallbackWrite(text: string) {
  if (typeof document === 'undefined') return false
  const helper = document.createElement('textarea')
  helper.value = text
  helper.setAttribute('readonly', '')
  helper.style.position = 'fixed'
  helper.style.left = '-10000px'
  helper.style.top = '0'
  helper.style.opacity = '0'
  document.body.appendChild(helper)
  helper.select()
  let result = false
  try {
    result = document.execCommand('copy')
  } catch {
    result = false
  } finally {
    helper.remove()
  }
  return result
}

export async function writeClipboardText(text: string) {
  if (canUseClipboardApi()) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the WebView editing command.
    }
  }
  return fallbackWrite(text)
}

export async function readClipboardText(target?: TextControl): Promise<ClipboardReadResult> {
  if (canUseClipboardApi()) {
    try {
      return { ok: true, text: await navigator.clipboard.readText() }
    } catch {
      // Fall through to the native editing command when a control exists.
    }
  }
  if (!target || typeof document === 'undefined') return { ok: false }
  target.focus()
  try {
    const nativeApplied = document.execCommand('paste')
    return nativeApplied ? { ok: true, nativeApplied: true } : { ok: false }
  } catch {
    return { ok: false }
  }
}

export function replaceTextControlSelection(target: TextControl, text: string) {
  const range = selectionRange(target)
  target.focus()
  target.setRangeText(text, range.start, range.end, 'end')
  dispatchInput(target, 'insertFromPaste', text)
}

export function deleteTextControlSelection(target: TextControl) {
  const range = selectionRange(target)
  target.focus()
  target.setRangeText('', range.start, range.end, 'start')
  dispatchInput(target, 'deleteByCut', null)
}

export function textControlSelection(target: TextControl) {
  const range = selectionRange(target)
  return {
    ...range,
    text: target.value.slice(range.start, range.end),
  }
}
