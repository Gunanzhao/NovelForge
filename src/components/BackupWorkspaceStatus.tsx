import { useEffect, useState } from 'react'
import { HardDrive, TriangleAlert, X } from 'lucide-react'
import { refreshBackupStatus, retryIndependentBackup, useAutoBackup } from '../lib/automatic-backups'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, IconButton } from './ui'

function useBackupHealth() {
  const path = useAppStore(state => state.projectPath)
  const shared = useAutoBackup(state => path && state.path === path ? state : null)
  const settings = shared?.status?.settings
  const error = shared?.error || settings?.lastError || ''
  const problem = settings ? '独立备份失败' : '无法读取独立备份状态'
  const lastSuccess = settings?.lastSuccess ? new Date(settings.lastSuccess).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : null
  return { error, problem, lastSuccess, busy: shared?.busy ?? false, settings }
}

export function BackupStatusIndicator({ onSettings }: { onSettings: () => void }) {
  const { error, problem, lastSuccess, busy, settings } = useBackupHealth()
  if (!error && !busy && !settings?.enabled && !lastSuccess) return null
  const label = busy ? '正在备份…' : error ? problem : lastSuccess ? '最近备份 ' + lastSuccess : '独立备份待运行'
  return <button type="button" className={'backup-status-indicator' + (error ? ' has-error' : '')}
    onClick={onSettings} title={error ? problem + '：' + error + (lastSuccess ? '；最近成功 ' + lastSuccess : '') : '打开独立备份设置'}>
    {error ? <TriangleAlert size={12} aria-hidden="true" /> : <HardDrive size={12} aria-hidden="true" />}{label}
  </button>
}

export function BackupWorkspaceNotice({ hidden, onSettings }: { hidden: boolean; onSettings: () => void }) {
  const { error, problem, busy, settings } = useBackupHealth()
  const [dismissed, setDismissed] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  useEffect(() => {
    if (!error) setDismissed('')
    setRetryError('')
  }, [error])

  async function retry() {
    if (busy || retrying) return
    const session = captureProjectSession()
    setRetrying(true)
    setRetryError('')
    try {
      if (!settings) await refreshBackupStatus(session)
      else await retryIndependentBackup(session)
    } catch (reason) {
      if (isCurrentProjectSession(session)) setRetryError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isCurrentProjectSession(session)) setRetrying(false)
    }
  }

  if (hidden || !error || dismissed === error) return null
  return <div className="backup-workspace-notice">
    <TriangleAlert size={16} aria-hidden="true" />
    <div className="backup-workspace-message" role="status"><strong>{problem}</strong><span>{retryError || error}</span></div>
    <div className="backup-workspace-actions">
      {(!settings || settings.directory) && <Button variant="outline" disabled={busy || retrying} onClick={() => void retry()}>{busy || retrying ? '正在检查…' : settings ? '重试备份' : '重试检查'}</Button>}
      <Button variant="ghost" onClick={onSettings}>备份设置</Button>
      <IconButton icon={X} label="暂时收起备份提示" onClick={() => setDismissed(error)} />
    </div>
  </div>
}
