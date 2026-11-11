import { useEffect, useRef, useState } from 'react'
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
  if (!settings && !error && !busy) return null
  const label = busy ? '正在备份…' : error ? problem : !settings?.enabled ? (lastSuccess ? '独立备份已暂停' : '独立备份未设置') : lastSuccess ? '最近备份 ' + lastSuccess : '独立备份待运行'
  return <button type="button" className={'backup-status-indicator' + (error ? ' has-error' : '')}
    onClick={onSettings} title={error ? problem + '：' + error + (lastSuccess ? '；最近成功 ' + lastSuccess : '') : '打开独立备份设置'}>
    {error ? <TriangleAlert size={12} aria-hidden="true" /> : <HardDrive size={12} aria-hidden="true" />}{label}
  </button>
}

export function BackupWorkspaceNotice({ hidden, onSettings }: { hidden: boolean; onSettings: () => void }) {
  const { error, problem, busy, settings } = useBackupHealth()
  const path = useAppStore(state => state.projectPath)
  const [invitation, setInvitation] = useState(false)
  const skipped = useRef(new Set<string>())
  useEffect(() => {
    setInvitation(false)
    if (!path) return
    return useAppStore.subscribe((state, previous) => {
      if (state.projectPath !== path || state.projectSession !== previous.projectSession || !state.document || state.document.node.id !== previous.document?.node.id) return
      if (state.saveState !== 'saved' || state.document.persistedContent === previous.document.persistedContent || state.document.content.replace(/\s/gu, '').length < 20) return
      if (skipped.current.has(path)) return
      try { if (localStorage.getItem('novelforge:backup-introduction:' + path)) return } catch { /* in-memory dismissal still works */ }
      setInvitation(true)
    })
  }, [path])
  function dismissInvitation() {
    if (path) skipped.current.add(path)
    setInvitation(false)
    try { localStorage.setItem('novelforge:backup-introduction:' + path, 'seen') } catch { /* optional preference */ }
  }
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

  if (hidden) return null
  if (!error && invitation && settings && !settings.enabled && !settings.lastSuccess) return <div className="backup-workspace-notice">
    <HardDrive size={16} aria-hidden="true" />
    <div className="backup-workspace-message" role="status"><strong>正文已保存，还可以设置独立备份</strong><span>将项目备份到另一个文件夹，保留可恢复的完整副本。</span></div>
    <div className="backup-workspace-actions"><Button variant="outline" onClick={() => { dismissInvitation(); onSettings() }}>设置独立备份</Button><Button variant="ghost" onClick={dismissInvitation}>暂时跳过</Button></div>
  </div>
  if (!error || dismissed === error) return null
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
