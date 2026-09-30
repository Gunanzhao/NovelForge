import { useState } from 'react'
import { snapshotApi, useSnapshotStatus } from '../lib/draft-snapshots'
import type { DraftSnapshot } from '../lib/draft-snapshot-scheduler'
import { useAppStore } from '../stores/app-store'
import { writeClipboardText } from '../lib/clipboard'
export function DraftSnapshotRecovery() {
  const [items, setItems] = useState<DraftSnapshot[]>([])
  const [selected, setSelected] = useState<DraftSnapshot | null>(null)
  const [message, setMessage] = useState('')
  const current = useAppStore(state => state.document)
  const projectId = useAppStore(state => state.data?.project.id)
  const error = useSnapshotStatus(state => state.error)
  const text = selected && selected.payload && typeof selected.payload === 'object' && 'content' in selected.payload && typeof selected.payload.content === 'string' ? selected.payload.content : selected ? JSON.stringify(selected.payload, null, 2) : ''
  return <section className="settings-card"><h2>独立草稿快照</h2>
    <p>每 10 秒尝试保护正文和资料草稿。异常退出后请先对照或导出；不会自动覆盖项目。浏览器演示模式仅保留内存副本。</p>
    {error ? <p role="alert">{error}</p> : null}
    <button onClick={() => { void snapshotApi.list().then(setItems).catch(() => setMessage('草稿列表读取失败，原文件仍保留。')) }}>查看独立草稿</button>
    {items.map(item => <button key={item.id} onClick={() => setSelected(item)}>{item.label} · {item.capturedAt} · {item.projectId === projectId ? '当前作品' : '其他作品'}</button>)}
    {selected ? <div><p>草稿版本：{selected.version} · 目标：{selected.targetId}</p>
      <textarea readOnly aria-label="独立草稿内容" value={text} style={{ width: '100%', minHeight: 180 }} />
      {current && selected.projectId === projectId && selected.targetId === 'document:' + current.node.id ? <><p>{current.content === text ? '与当前正文相同' : '与当前正文不同，请对照后另存'}</p><textarea readOnly aria-label="当前正文对照" value={current.content} /></> : null}
      <button onClick={() => { void writeClipboardText(text).then(ok => setMessage(ok ? '草稿已复制' : '请在文本框手动复制')).catch(() => setMessage('请在文本框手动复制')) }}>复制独立草稿</button>
      <button onClick={() => {
        try { const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'NovelForge-draft-' + selected.id + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); setMessage('已请求导出，请确认下载文件后再处理草稿。') }
        catch { setMessage('导出失败，请复制草稿内容。') }
      }}>导出独立草稿</button>
      <button onClick={() => {
        if (!window.confirm('确认已保存导出文件，并移除此版本独立草稿？此操作不会删除项目正文。')) return
        void snapshotApi.acknowledge(selected.id).then(async () => { setSelected(null); setItems(await snapshotApi.list()) }).catch(() => setMessage('草稿移除失败，原文件保留。'))
      }}>已导出，移除此版本</button>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>
}
export function DraftSnapshotNotice() {
  const error = useSnapshotStatus(state => state.error)
  return error ? <div role="alert" className="toast-error">{error}</div> : null
}
