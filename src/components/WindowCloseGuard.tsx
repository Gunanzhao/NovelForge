import { confirmDraftNavigation, dirtyDrafts } from '../lib/draft-guard'
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isDesktop } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { isCurrentDocumentSaved, useAppStore } from '../stores/app-store'
import { Button, Modal } from './ui'

export function WindowCloseGuard() {
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const closing = useRef(false)
  const content = useAppStore((state) => state.document?.content ?? '')
  const error = useAppStore((state) => state.error)

  const attemptClose = useCallback(async () => {
    if (closing.current) return
    closing.current = true
    try {
      if (!await confirmDraftNavigation()) return
      setBusy(true)
      const store = useAppStore.getState()
      if (store.document && !await store.saveCurrentDocument('关闭窗口前保存')) {
        setFailed(true)
        return
      }
      if (!isCurrentDocumentSaved()) { setFailed(true); return }
      await invoke('confirm_window_close')
    } catch (e) {
      useAppStore.getState().setError(e)
      setFailed(true)
    } finally { closing.current = false; setBusy(false) }
  }, [])

  useEffect(() => {
    if (!isDesktop) {
      const beforeUnload = (event: BeforeUnloadEvent) => {
        const store = useAppStore.getState()
        if (dirtyDrafts().length || (store.document && store.saveState !== 'saved')) { event.preventDefault(); event.returnValue = '' }
      }
      window.addEventListener('beforeunload', beforeUnload)
      return () => window.removeEventListener('beforeunload', beforeUnload)
    }
    let disposed = false
    const registration = listen('novelforge:request-close', () => { if (!disposed) void attemptClose() })
    void registration.catch((e) => useAppStore.getState().setError(e))
    return () => { disposed = true; void registration.then((unlisten) => unlisten()).catch(() => {}) }
  }, [attemptClose])

  async function discard() {
    if (!window.confirm('确定放弃未保存的正文并退出？请先复制需要保留的内容。')) return
    setBusy(true)
    try { await invoke('confirm_window_close') }
    catch (e) { useAppStore.getState().setError(e) }
    finally { setBusy(false) }
  }

  return <Modal open={failed || busy} title={busy ? '正在保存并关闭…' : '正文尚未保存，已阻止退出'} onClose={() => { if (!busy) setFailed(false) }} footer={<>
    <Button variant="outline" disabled={busy} onClick={() => setFailed(false)}>继续编辑</Button>
    <Button variant="outline" disabled={busy} onClick={() => void writeClipboardText(content).then((ok) => { if (!ok) useAppStore.getState().setError('复制失败，请从下方文本框手动复制正文') })}>复制正文</Button>
    <Button disabled={busy} onClick={() => void attemptClose()}>重试保存并退出</Button>
    <Button variant="danger" disabled={busy} onClick={() => void discard()}>放弃修改并退出</Button>
  </>}>
    <p role="alert">{error ?? '保存未完成，请保留正文后再退出。'}</p>
    <textarea className="text-area" readOnly aria-label="未保存正文" value={content} />
  </Modal>
}
