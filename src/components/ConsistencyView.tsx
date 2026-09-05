import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, CircleHelp, RefreshCw, ShieldAlert } from 'lucide-react'
import { projectApi } from '../lib/api'
import type { ConsistencyIssue, ConsistencyReport, EntityKind } from '../lib/types'
import { ENTITY_LABELS } from '../lib/types'
import { formatDate, formatNumber } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import { Button, Panel, TextInput } from './ui'

type IssueFilter = 'all' | ConsistencyIssue['severity']

function SeverityIcon({ severity }: { severity: ConsistencyIssue['severity'] }) {
  if (severity === 'error') return <AlertCircle size={16} />
  if (severity === 'warning') return <ShieldAlert size={16} />
  return <CircleHelp size={16} />
}

export function ConsistencyView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const selectNode = useAppStore((state) => state.selectNode)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const setView = useAppStore((state) => state.setView)
  const setError = useAppStore((state) => state.setError)
  const [report, setReport] = useState<ConsistencyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [severity, setSeverity] = useState<IssueFilter>('all')

  const runCheck = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      setReport(await projectApi.consistency(projectPath))
    } catch (error) {
      setError(error)
    } finally {
      setLoading(false)
    }
  }, [projectPath, setError])

  useEffect(() => { void runCheck() }, [runCheck])

  const visibleIssues = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return (report?.issues ?? []).filter((issue) => {
      const severityMatches = severity === 'all' || issue.severity === severity
      const textMatches = !query || [issue.title, issue.detail, issue.path].join(' ').toLocaleLowerCase().includes(query)
      return severityMatches && textMatches
    })
  }, [filter, report, severity])

  if (!data || !projectPath) return null
  const currentData = data

  function openIssue(issue: ConsistencyIssue) {
    if (issue.refKind === 'chapter' || issue.refKind === 'section') {
      void selectNode(issue.refId)
      return
    }
    if (issue.refKind === 'entity' || Object.hasOwn(ENTITY_LABELS, issue.refKind)) {
      const entity = currentData.entities.find((candidate) => candidate.id === issue.refId && (issue.refKind === 'entity' || candidate.kind === issue.refKind))
      if (entity) selectEntity(entity.kind, entity.id)
      else if (issue.refKind === 'relationship') setView('relationship')
      return
    }
  }

  return <div className="workspace-view consistency-view">
    <div className="view-header"><div><p className="eyebrow">STORY CONSISTENCY</p><h1>一致性检查</h1><p>检查正文 Wiki 链接、章节引用、重复资料和人物关系，尽早发现长篇写作中的断链。</p></div><Button variant="outline" disabled={loading} onClick={() => void runCheck()}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? '检查中…' : '重新检查'}</Button></div>
    <div className="consistency-summary"><Panel className="consistency-metric"><span>问题总数</span><strong>{formatNumber(report?.issueCount ?? 0)}</strong><small>{report ? '检查于 ' + formatDate(report.checkedAt) : '尚未检查'}</small></Panel><Panel className="consistency-metric error"><span>错误</span><strong>{formatNumber(report?.errors ?? 0)}</strong><small>需要优先处理</small></Panel><Panel className="consistency-metric warning"><span>提醒</span><strong>{formatNumber(report?.warnings ?? 0)}</strong><small>建议逐项确认</small></Panel><Panel className="consistency-metric clean"><span>状态</span><strong>{report && report.issueCount === 0 ? '干净' : report ? '待处理' : '—'}</strong><small>{report && report.issueCount === 0 ? '当前没有发现问题' : '支持筛选和跳转'}</small></Panel></div>
    <div className="consistency-toolbar"><div className="special-search"><TextInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索问题、详情或文件路径" /></div><div className="consistency-filters"><button type="button" className={severity === 'all' ? 'active' : ''} onClick={() => setSeverity('all')}>全部</button><button type="button" className={severity === 'error' ? 'active error' : ''} onClick={() => setSeverity('error')}>错误 {report?.errors ?? 0}</button><button type="button" className={severity === 'warning' ? 'active warning' : ''} onClick={() => setSeverity('warning')}>提醒 {report?.warnings ?? 0}</button></div></div>
    <Panel className="consistency-list-panel">{visibleIssues.length ? <div className="consistency-list">{visibleIssues.map((issue) => <div className={'consistency-issue ' + issue.severity} key={issue.id}><span className="consistency-issue-icon"><SeverityIcon severity={issue.severity} /></span><div className="consistency-issue-copy"><div><strong>{issue.title}</strong><span className="consistency-code">{issue.code}</span></div><p>{issue.detail}</p><small>{ENTITY_LABELS[issue.refKind as EntityKind] ?? issue.refKind} · {issue.path}</small></div><Button variant="ghost" onClick={() => openIssue(issue)}>定位</Button></div>)}</div> : <div className="consistency-clean"><CheckCircle2 size={30} /><strong>{report ? (filter || severity !== 'all' ? '没有匹配问题' : '检查通过') : '准备开始检查'}</strong><span>{report ? (filter || severity !== 'all' ? '换一个筛选条件试试。' : '没有发现明显的资料断链或章节引用问题。') : '点击“重新检查”扫描当前项目。'}</span></div>}</Panel>
  </div>
}
