import { useState } from 'react'
import { BookOpen, CheckCircle2, FileClock, Flame, HardDrive, RotateCcw, Sparkles, Target, Trash2 } from 'lucide-react'
import { projectApi } from '../lib/api'
import { formatDate, formatNumber } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import { Button, Modal, Panel } from './ui'

export function Dashboard() {
  const data = useAppStore((state) => state.data)
  const stats = useAppStore((state) => state.stats)
  const projectPath = useAppStore((state) => state.projectPath)
  const selectNode = useAppStore((state) => state.selectNode)
  const refreshData = useAppStore((state) => state.refreshData)
  const setError = useAppStore((state) => state.setError)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [ignoredRecoveryId, setIgnoredRecoveryId] = useState<string | null>(null)
  const [recoveryPreview, setRecoveryPreview] = useState<{ id: string; title: string; content: string } | null>(null)

  if (!data || !projectPath) return null
  const chapters = data.nodes.filter((node) => node.kind === 'chapter').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)
  const progress = stats.targetWords > 0 ? Math.min(100, Math.round((stats.totalWords / stats.targetWords) * 100)) : 0
  const recovery = data.recovery.find((item) => item.id !== ignoredRecoveryId)
  const currentProjectPath = projectPath
  const currentData = data

  async function previewRecovery() {
    if (!recovery) return
    setRecoveryBusy(true)
    try {
      const content = await projectApi.readRecovery({ projectPath: currentProjectPath, recoveryId: recovery.id })
      setRecoveryPreview({ id: recovery.id, title: recovery.nodeTitle, content })
    } catch (error) { setError(error) } finally { setRecoveryBusy(false) }
  }

  function ignoreRecovery() {
    if (!recovery) return
    setIgnoredRecoveryId(recovery.id)
    setRecoveryPreview(null)
  }

  async function restoreRecovery() {
    if (!recovery) return
    setRecoveryBusy(true)
    try {
      await refreshData(await projectApi.restoreRecovery({ projectPath: currentProjectPath, recoveryId: recovery.id }), false)
      setIgnoredRecoveryId(null)
      setRecoveryPreview(null)
    } catch (error) { setError(error) } finally { setRecoveryBusy(false) }
  }

  async function discardRecovery() {
    if (!recovery || !window.confirm('删除这份恢复数据？删除后无法从 NovelForge 恢复。')) return
    setRecoveryBusy(true)
    try {
      const remaining = await projectApi.discardRecovery({ projectPath: currentProjectPath, recoveryId: recovery.id })
      await refreshData({ project: currentData.project, nodes: currentData.nodes, entities: currentData.entities, recovery: remaining }, true)
      setIgnoredRecoveryId(null)
      setRecoveryPreview(null)
    } catch (error) { setError(error) } finally { setRecoveryBusy(false) }
  }

  return <div className="workspace-view">
    {recovery ? <div className="recovery-banner"><RotateCcw size={15} /><strong>检测到未恢复的写作内容：{recovery.nodeTitle}</strong><span>来自 {recovery.createdAt}</span><div className="banner-actions"><Button variant="ghost" disabled={recoveryBusy} onClick={() => void previewRecovery()}>查看</Button><Button variant="outline" disabled={recoveryBusy} onClick={ignoreRecovery}>稍后处理</Button><Button variant="danger" disabled={recoveryBusy} onClick={() => void discardRecovery()}>删除</Button><Button disabled={recoveryBusy} onClick={() => void restoreRecovery()}>恢复</Button></div></div> : null}
    <div className="view-header"><div><p className="eyebrow">PROJECT DASHBOARD</p><h1>{data.project.title}</h1><p>{data.project.description || '把设定、结构和每一次落笔，收拢在同一个安静的工作台。'}</p></div><div className="view-actions"><Button variant="outline" onClick={() => void selectNode(chapters[0]?.id ?? '')}><BookOpen size={15} />继续写作</Button></div></div>
    <div className="dashboard-grid">
      <Panel className="metric-card"><span className="metric-label">总字数</span><div className="metric-value">{formatNumber(stats.totalWords)}</div><span className="metric-sub">跨 {formatNumber(stats.chapterCount)} 个章节</span></Panel>
      <Panel className="metric-card"><span className="metric-label">今日新增</span><div className="metric-value">{formatNumber(stats.todayWords)}</div><span className="metric-sub">昨日 {formatNumber(stats.yesterdayWords)}</span></Panel>
      <Panel className="metric-card"><span className="metric-label">连续写作</span><div className="metric-value">{formatNumber(stats.writingStreak)}<small style={{ fontSize: 12 }}> 天</small></div><span className="metric-sub"><Flame size={11} style={{ verticalAlign: 'middle' }} /> 保持节奏</span></Panel>
      <Panel className="metric-card"><span className="metric-label">项目目标</span><div className="metric-value">{progress}<small style={{ fontSize: 12 }}>%</small></div><span className="metric-sub">{formatNumber(stats.targetWords)} 字目标</span></Panel>
    </div>
    <div className="dashboard-columns">
      <Panel className="dashboard-panel"><div className="panel-title"><h3>最近修改</h3><span>按最后保存排序</span></div>{chapters.length ? <div className="recent-list">{chapters.map((chapter, index) => <button className="recent-item" key={chapter.id} onClick={() => void selectNode(chapter.id)}><span className="recent-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{chapter.title}</strong><small>{chapter.status === 'done' ? '已完成' : chapter.status === 'editing' ? '修改中' : '草稿'} · {formatDate(chapter.updatedAt)}</small></span></button>)}</div> : <div className="empty-state"><BookOpen size={22} /><div><strong>还没有章节</strong><span>从左侧正文结构创建第一卷和章节。</span></div></div>}</Panel>
      <div style={{ display: 'grid', gap: 10 }}>
        <Panel className="dashboard-panel"><div className="panel-title"><h3>写作目标</h3><Target size={15} color="var(--accent)" /></div><div className="progress-wrap"><div className="progress-track"><div className="progress-bar" style={{ width: String(progress) + '%' }} /></div><div className="progress-meta"><span>{formatNumber(stats.totalWords)} 字</span><span>{formatNumber(stats.targetWords)} 字</span></div></div><p className="metric-sub">本周新增 {formatNumber(stats.weekWords)} 字 · 本月新增 {formatNumber(stats.monthWords)} 字</p></Panel>
        <Panel className="dashboard-panel"><div className="panel-title"><h3>本地优先</h3><HardDrive size={15} color="var(--green)" /></div><p className="metric-sub" style={{ lineHeight: 1.7 }}>正文以 Markdown 文件保存。SQLite 只负责索引与资料；自动保存、恢复文件和历史快照共同保护你的写作。</p><div className="inspector-actions"><span className="tag"><CheckCircle2 size={11} /> 无需账号</span><span className="tag"><FileClock size={11} /> 有版本历史</span></div></Panel>
      </div>
    </div>
    <div className="dashboard-columns" style={{ paddingTop: 0 }}>
      <Panel className="dashboard-panel"><div className="panel-title"><h3>下一步</h3><Sparkles size={15} color="var(--accent)" /></div><div className="inspector-actions"><Button variant="outline" onClick={() => useAppStore.getState().setView('character')}>建立人物</Button><Button variant="outline" onClick={() => useAppStore.getState().setView('world')}>补充世界观</Button><Button variant="outline" onClick={() => useAppStore.getState().setView('search')}>搜索全文</Button></div></Panel>
      <Panel className="dashboard-panel"><div className="panel-title"><h3>安全提醒</h3><Trash2 size={15} color="var(--muted)" /></div><p className="metric-sub" style={{ lineHeight: 1.7 }}>删除内容不会立即永久消失，会先进入项目内的 <code>trash/</code> 目录。</p></Panel>
    </div>
    {recoveryPreview ? <Modal open title={`恢复内容 · ${recoveryPreview.title}`} onClose={() => setRecoveryPreview(null)} footer={<Button variant="outline" onClick={() => setRecoveryPreview(null)}>关闭</Button>}><pre className="history-preview" style={{ maxHeight: '60vh' }}>{recoveryPreview.content}</pre></Modal> : null}
  </div>
}
