import { useEffect, useState } from 'react'
import { useNotification } from '../lib/notifications'
import { useAppStore } from '../stores/app-store'
export function OperationNotice() {
  const notice = useNotification(state => state.notice)
  const session = useAppStore(state => state.projectSession)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setError(''); if (!notice || notice.undo) return; const timer = window.setTimeout(() => useNotification.setState(state => ({ notice: state.notice === notice ? null : state.notice })), 4000); return () => window.clearTimeout(timer) }, [notice])
  if (!notice || notice.session !== session) return null
  return <div className="toast-notice" role="status"><span>{notice.message}{error && <span role="alert"> · {error}</span>}</span>{notice.undo && <button disabled={busy} onClick={() => { setBusy(true); setError(''); void notice.undo!().then(() => useNotification.setState(state => ({ notice: state.notice === notice ? null : state.notice }))).catch(error => setError(String(error))).finally(() => setBusy(false)) }}>{busy ? '正在恢复…' : '撤销移入回收站'}</button>}<button aria-label="关闭操作提示" onClick={() => useNotification.setState({ notice: null })}>×</button></div>
}
