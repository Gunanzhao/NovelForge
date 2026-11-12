import { useState } from 'react'
import { projectApi } from '../lib/api'
import { decodeManuscript } from '../lib/manuscript-import'
import { matchRevisionFile, revisionFileIssue, type RevisionFile } from '../lib/revision-batch'
import type { RevisionChapterSummary } from '../lib/revision-workbench'
import { isCurrentProjectSession, type ProjectSession } from '../stores/app-store'
import { Button, Modal } from './ui'

export function RevisionBatchImport({ projectPath, roundId, chapters, busy, error, run, onRefresh, onClose }: {
  projectPath: string; roundId: string; chapters: RevisionChapterSummary[]; busy: boolean; error: string
  run: (action: (session: ProjectSession) => Promise<void>) => Promise<boolean>
  onRefresh: () => Promise<void>; onClose: () => void
}) {
  const [files, setFiles] = useState<RevisionFile[]>([])
  const [notice, setNotice] = useState('')
  const eligible = files.filter(file => !file.saved && !revisionFileIssue(file, files, chapters))
  async function read(selected: File[]) {
    await run(async session => {
      if (selected.length > 100 || selected.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) throw new Error('每批最多 100 个文件、合计 32 MiB。')
      const next: RevisionFile[] = []
      for (const file of selected) {
        const row: RevisionFile = { name: file.name, content: '', targetId: matchRevisionFile(file.name, chapters), error: '' }
        try {
          if (!/\.(?:txt|md|markdown)$/iu.test(file.name) || file.size > 2 * 1024 * 1024) throw new Error('只支持不超过 2 MiB 的 TXT / Markdown')
          row.content = decodeManuscript(new Uint8Array(await file.arrayBuffer())).text
          if (!row.content.trim()) throw new Error('文件内容为空')
        } catch (error) { row.error = String(error) }
        if (!isCurrentProjectSession(session)) return
        next.push(row)
      }
      setFiles(next); setNotice('请核对文件与章节匹配。已有改稿和已确认章节不会被覆盖。')
    })
  }
  async function save() {
    await run(async session => {
      let saved = 0
      const next = files.map(file => ({ ...file }))
      for (const file of next) {
        if (!isCurrentProjectSession(session)) return
        if (file.saved || revisionFileIssue(file, files, chapters)) continue
        try {
          const view = await projectApi.openRevisionRound({ projectPath, roundId, nodeId: file.targetId })
          if (!isCurrentProjectSession(session)) return
          const current = view.current
          if (current.candidate !== null || current.confirmedAt) throw new Error('目标已有改稿或已确认，未覆盖')
          if (current.sourceIssue || current.currentContent !== null) throw new Error('原文发生变化或不可用，请逐章复核')
          await projectApi.saveRevisionCandidate({ projectPath, roundId, nodeId: file.targetId, expectedVersion: current.version }, file.content)
          file.saved = true; saved++
        } catch (error) { file.error = String(error) }
        if (!isCurrentProjectSession(session)) return
        setFiles(next.map(row => ({ ...row })))
      }
      if (!isCurrentProjectSession(session)) return
      setNotice(`本次已保存 ${saved} 份待确认改稿。正文未改动；请关闭预览后逐章核对并确认应用。`)
      await onRefresh()
    })
  }
  const missing = chapters.filter(chapter => !chapter.confirmedAt && !chapter.hasCandidate && !files.some(file => file.targetId === chapter.nodeId))
  return <Modal open title="批量载入改稿" className="revision-batch-modal" onClose={() => { if (!busy) onClose() }} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>关闭预览</Button><Button disabled={busy || !eligible.length} onClick={() => void save()}>{busy ? '正在处理…' : `保存匹配改稿（${eligible.length}）`}</Button></>}>
    <p>文件名与章节名一致时自动匹配；重名或未匹配文件可手动选择。每个文件对应一章或一个小节。</p>
    <label className="revision-file">选择批量改稿文件<input type="file" multiple accept=".txt,.md,.markdown" disabled={busy} onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; if (selected.length) void read(selected) }} /></label>
    <p role="status">{notice}</p>{error && <p role="alert">{error}</p>}
    {files.map((file, index) => <div className="revision-batch-row" key={index}>
      <strong>{file.name}</strong>
      <select className="select-input" aria-label={'目标章节：' + file.name} value={file.targetId} disabled={busy || file.saved || Boolean(file.error)} onChange={event => setFiles(files.map((row, i) => i === index ? { ...row, targetId: event.target.value } : row))}><option value="">请选择目标章节</option>{chapters.map((chapter, i) => <option key={chapter.nodeId} value={chapter.nodeId}>{i + 1}. {chapter.title}{chapter.kind === 'section' ? '（小节）' : ''}</option>)}</select>
      <span>{revisionFileIssue(file, files, chapters) || '匹配成功，待保存'}</span>
      <details><summary>查看文件内容（{file.content.length.toLocaleString()} 字符）</summary><pre className="revision-text">{file.content}</pre></details>
    </div>)}
    {files.length > 0 && <details><summary>本轮尚未匹配文件的待录入条目（{missing.length}）</summary><ul>{missing.map(chapter => <li key={chapter.nodeId}>{chapter.title}</li>)}</ul></details>}
  </Modal>
}
