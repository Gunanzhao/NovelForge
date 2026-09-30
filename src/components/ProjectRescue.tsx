import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { chooseDirectory, isDesktop } from '../lib/api'
interface Rescue { unresolved: boolean; notice: string; files: Array<{ path: string; content: string }> }
export function ProjectRescue() {
  const [path, setPath] = useState(''), [report, setReport] = useState<Rescue | null>(null), [selected, setSelected] = useState(0), [error, setError] = useState('')
  if (!isDesktop) return null
  return <section className="settings-card"><h2>项目只读救援</h2><p>项目无法正常打开时，读取安全可读的 Markdown 并导出救援副本。原始日志和数据库保留；救援副本不是完整备份。</p>
    <button onClick={() => { void (async () => { try { const chosen = await chooseDirectory(); if (!chosen) return; setPath(chosen); setReport(null); setError(''); setReport(await invoke<Rescue>('inspect_project_rescue', { path: chosen })); setSelected(0) } catch (e) { setError(String(e)) } })() }}>选择项目进行只读检查</button>
    {report ? <><p>{report.unresolved ? '存在未解决日志，正常写入仍被阻止。' : '只读检查结果'}</p><pre>{report.notice}</pre><select aria-label="救援文件" value={selected} onChange={event => setSelected(Number(event.target.value))}>{report.files.map((file, i) => <option key={file.path} value={i}>{file.path}</option>)}</select><textarea aria-label="项目救援正文" readOnly value={report.files[selected]?.content ?? ''} style={{ width: '100%', minHeight: 160 }} />
      <button onClick={() => { try { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'NovelForge-project-rescue.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000) } catch { setError('导出失败，请复制救援文本并保留原项目。') } }}>导出全部救援副本</button>
      {report.unresolved ? <button onClick={() => { void invoke('verify_project_recovery', { path }).then(() => setError('一致性复核通过，可以重新打开项目。')).catch(e => setError(String(e))) }}>验证原始日志与一致性后解除只读</button> : null}
    </> : null}{error ? <p role="alert">{error}</p> : null}
  </section>
}
