import { useEffect, useState } from 'react'
import { projectApi } from '../lib/api'
import type { DocumentData } from '../lib/types'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, Modal } from './ui'
export function DocumentConflictDialog() {
  const error = useAppStore(state => state.error)
  const document = useAppStore(state => state.document)
  const projectPath = useAppStore(state => state.projectPath)
  const [disk, setDisk] = useState<DocumentData | null>(null)
  const [readError, setReadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const open = Boolean(error?.startsWith('EXTERNAL_CONFLICT:'))
  useEffect(() => {
    if (!open || !projectPath || !document) return
    let cancelled = false
    setDisk(null); setReadError(''); setLoading(true)
    void projectApi.getDocument({ projectPath, nodeId: document.node.id }).then(value => { if (!cancelled) setDisk(value) }).catch(error => { if (!cancelled) setReadError(String(error)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, projectPath, document, attempt])
  async function reload() {
    if (!projectPath || !document) return
    const session = captureProjectSession(); setLoading(true)
    try {
      // Read again so a change made while the dialog was open is not missed.
      const fresh = await projectApi.getDocument({ projectPath, nodeId: document.node.id })
      if (!isCurrentProjectSession(session)) return
      useAppStore.setState(state => ({ document: { ...fresh, persistedContent: fresh.content }, documentVersion: state.documentVersion + 1, saveState: 'saved', error: null }))
    } catch (error) { setReadError(String(error)) } finally { setLoading(false) }
  }
  return <Modal open={open} title="正文存在外部修改" onClose={() => useAppStore.getState().clearError()} footer={<><Button variant="outline" onClick={() => useAppStore.getState().clearError()}>继续编辑本地内容</Button><Button disabled={loading || !disk} onClick={() => void reload()}>保留恢复副本并读取磁盘版本</Button></>}>
    <p>{error?.replace('EXTERNAL_CONFLICT:', '')}</p><p className="field-hint">可复制下方内容手动合并。恢复副本可从项目恢复入口重新读取；当前操作不会覆盖磁盘版本。</p>
    {readError && <div role="alert">{readError}<Button onClick={() => setAttempt(value => value + 1)}>重试读取</Button></div>}
    <div className="conflict-comparison"><label>编辑器内容<textarea readOnly className="text-area" value={document?.content ?? ''} /></label><label>磁盘内容<textarea readOnly className="text-area" value={loading ? '正在读取…' : disk?.content ?? ''} /></label></div>
  </Modal>
}
