import { useState } from 'react'
import { chooseDirectory, chooseFile, isDesktop, projectApi } from '../lib/api'
import type { BackupReport } from '../lib/api'
import { saveActiveDrafts } from '../lib/draft-guard'
import { useAppStore } from '../stores/app-store'
import { writeClipboardText } from '../lib/clipboard'
import { Button, Panel } from './ui'
export function ProjectBackup({ restoreOnly = false }: { restoreOnly?: boolean }) {
  const projectPath = useAppStore(state => state.projectPath)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<(BackupReport & { restored: boolean }) | null>(null)
  async function run(mode: 'backup' | 'validate' | 'restore') {
    setBusy(true); setError(''); setMessage(''); setResult(null)
    try {
      if (mode === 'backup') {
        if (!projectPath || !await saveActiveDrafts() || !await useAppStore.getState().saveCurrentDocument('整项目备份前保存')) throw new Error('当前修改未能保存，请先处理保存提示。')
        const directory = await chooseDirectory(); if (!directory) return
        setMessage('正在创建并校验完整备份…')
        const report = await projectApi.backup(projectPath, directory); setResult({ ...report, restored: false }); setMessage(`完整备份已创建并通过校验，共 ${report.fileCount} 个文件。`)
      } else {
        const path = await chooseFile(); if (!path) return
        if (mode === 'validate') { setMessage('正在校验备份…'); const report = await projectApi.validateBackup(path); setResult({ ...report, restored: false }); setMessage(`校验通过，共 ${report.fileCount} 个文件。`) }
        else { const directory = await chooseDirectory(); if (!directory) return; setMessage('正在校验并恢复到新目录…'); const report = await projectApi.restoreBackup(path, directory); setResult({ ...report, restored: true }); setMessage('已恢复到新目录，原项目保持不变。') }
      }
    } catch (error) { setError(String(error)); setMessage('') } finally { setBusy(false) }
  }
  if (!isDesktop) return null
  return <Panel className="settings-card project-backup"><h2>{restoreOnly ? '恢复项目备份' : '完整备份与恢复'}</h2><p className="field-hint">{restoreOnly ? '选择 .nfbackup 文件，校验后恢复到指定文件夹下的新目录。' : '包含正文、资料、附件、数据库、版本历史、恢复副本和回收站。缓存、索引和导出副本无需备份。'}</p><div className="backup-actions">{!restoreOnly && <Button disabled={busy || !projectPath} onClick={() => void run('backup')}>备份整个项目</Button>}<Button variant="outline" disabled={busy} onClick={() => void run('validate')}>校验备份</Button><Button variant="outline" disabled={busy} onClick={() => void run('restore')}>从备份恢复</Button></div><p role="status">{message}</p>{error && <p role="alert">{error}</p>}{result && <div className="backup-result"><code>{result.path}</code><Button variant="outline" onClick={() => void writeClipboardText(result.path).then(ok => { if (!ok) setError('复制失败，请手动复制路径') })}>复制路径</Button>{result.restored && <Button onClick={() => void useAppStore.getState().openProject(result.path).catch(error => setError(String(error)))}>打开恢复的项目</Button>}</div>}</Panel>
}
