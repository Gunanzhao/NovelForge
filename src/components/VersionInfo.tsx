import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { isDesktop, projectApi } from '../lib/api'
import type { UpdateInfo } from '../lib/api'
import metadata from '../../package.json'
import { Button, Panel } from './ui'
export function VersionInfo() {
  const [version, setVersion] = useState(metadata.version)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (isDesktop) void getVersion().then(setVersion).catch(() => undefined) }, [])
  async function check() {
    setBusy(true); setError(''); setInfo(null)
    try { setInfo(await projectApi.checkUpdates()) } catch (error) { setError(String(error)) } finally { setBusy(false) }
  }
  return <Panel className="settings-card version-info"><div className="settings-section-heading"><h2>关于与更新</h2><span>NovelForge {version}</span></div><p className="field-hint">{isDesktop ? 'Windows 桌面版' : '浏览器开发模式'} · 项目格式 v1。仅在点击检查时连接官方发布服务；预发布版也检查更新的候选版本。</p><div className="backup-actions"><Button variant="outline" disabled={busy || !isDesktop} onClick={() => void check()}>{busy ? '正在检查…' : '检查更新'}</Button><Button variant="outline" onClick={() => void projectApi.openExternalUrl(info?.url ?? 'https://github.com/Gunanzhao/NovelForge/releases').catch(error => setError(String(error)))}>发布说明与安装包</Button></div>{info && <p role="status">{info.available ? '发现新版本：' + info.latestVersion : '当前已是最新版本或更新的本地构建。'}{info.available ? ' 查看发布说明后，可下载安装包更新。' : ' 远端版本：' + info.latestVersion}</p>}{error && <p role="alert">检查失败：{error}，可重试或打开发布页。</p>}</Panel>
}
