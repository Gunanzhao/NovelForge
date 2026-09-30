import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '../lib/api'
import { captureProjectSession, isCurrentProjectSession } from '../stores/app-store'
interface Preview { bodyBytes: number; entityBytes: number; batchBytes: number; protectedCount: number; fingerprint: string; candidates: Array<{ id: string; kind: string; label: string; bytes: number }> }
export function HistoryStorage({ projectPath }: { projectPath: string }) {
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (!isDesktop) return null
  async function run(clean: boolean) {
    const session = captureProjectSession()
    if (busy || session.path !== projectPath || (clean && !preview)) return
    if (clean && !window.confirm(`确认清理预览中的 ${preview!.candidates.length} 份旧自动历史？命名、保护和每项最新版本保留。建议先创建备份。`)) return
    setBusy(true); setError('')
    try { const next = await invoke<Preview>(clean ? 'apply_history_cleanup' : 'preview_history_cleanup', clean ? { path: projectPath, fingerprint: preview!.fingerprint } : { path: projectPath }); if (isCurrentProjectSession(session)) setPreview(next) }
    catch (e) { if (isCurrentProjectSession(session)) setError(String(e)) }
    finally { if (isCurrentProjectSession(session)) setBusy(false) }
  }
  return <section className="settings-card"><h2>历史空间管理</h2><p>默认不自动删除。预览只选择旧自动版本，每项最新版本、命名和保护版本保留；活动统计、恢复副本和批量撤销数据不清理。数据库释放页供后续复用，文件体积未必立即缩小。</p>
    <button disabled={busy} onClick={() => { void run(false) }}>查看占用与清理预览</button>
    {preview ? <><p>正文历史 {preview.bodyBytes.toLocaleString()} 字节 · 资料历史 {preview.entityBytes.toLocaleString()} 字节 · 批量撤销 {preview.batchBytes.toLocaleString()} 字节</p><p>本次可清理 {preview.candidates.length} 份（最多 1000 份），保留 {preview.protectedCount} 份。</p><ul>{preview.candidates.map(item => <li key={item.id}>{item.kind === 'body' ? '正文' : '资料'} · {item.label} · {item.id} · {item.bytes} 字节</li>)}</ul><button disabled={busy || !preview.candidates.length} onClick={() => { void run(true) }}>确认清理上述旧自动历史</button></> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>
}
