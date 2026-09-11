import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../lib/api'
import type { DocumentData } from '../lib/types'
import { useAppStore } from '../stores/app-store'
import { Button, Modal } from './ui'
export function DocumentConflictDialog() {
  const error = useAppStore(state => state.error)
  const document = useAppStore(state => state.document)
  const projectPath = useAppStore(state => state.projectPath)
  const reloadGeneration = useRef({ generation: 0 })
  const [disk, setDisk] = useState<DocumentData | null>(null)
  const [readError, setReadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const open = Boolean(error?.startsWith('EXTERNAL_CONFLICT:'))
  useEffect(() => {
    if (!open || !projectPath || !document) return
    const reloadState = reloadGeneration.current
    let cancelled = false
    setDisk(null); setReadError(''); setLoading(true)
    void projectApi.getDocument({ projectPath, nodeId: document.node.id }).then(value => { if (!cancelled) setDisk(value) }).catch(error => { if (!cancelled) setReadError(String(error)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; reloadState.generation++ }
  }, [open, projectPath, document, attempt])
  async function reload() {
    if (!projectPath || !document) return
    const request = ++reloadGeneration.current.generation; setLoading(true)
    try { await useAppStore.getState().reloadConflictedDocument() }
    catch (error) { if (request === reloadGeneration.current.generation) setReadError(String(error)) }
    finally { if (request === reloadGeneration.current.generation) setLoading(false) }
  }
  return <Modal open={open} title="正文存在外部修改" onClose={() => useAppStore.getState().clearError()} footer={<><Button variant="outline" onClick={() => useAppStore.getState().clearError()}>继续编辑本地内容</Button><Button disabled={loading || !disk} onClick={() => void reload()}>保护当前内容并读取磁盘版本</Button></>}>
    <p>{error?.replace('EXTERNAL_CONFLICT:', '')}</p><p className="field-hint">可复制下方内容手动合并。恢复副本可从项目恢复入口重新读取；当前操作不会覆盖磁盘版本。</p>
    {readError && <div role="alert">{readError}<Button onClick={() => setAttempt(value => value + 1)}>重试读取</Button></div>}
    <div className="conflict-comparison"><label>编辑器内容<textarea readOnly className="text-area" value={document?.content ?? ''} /></label><label>磁盘内容<textarea readOnly className="text-area" value={loading ? '正在读取…' : disk?.content ?? ''} /></label></div>
  </Modal>
}
