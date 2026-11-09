import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FileCheck2, GitCompare, Plus, RefreshCw, Save } from 'lucide-react'
import { isDesktop, projectApi } from '../lib/api'
import { markDraftSaved, runGuarded, setDraftSaving } from '../lib/draft-guard'
import { historyChanged } from '../lib/history'
import { decodeManuscript } from '../lib/manuscript-import'
import { sortChapterNodes, sortManuscriptNodes } from '../lib/planning-data'
import type { RevisionChapter, RevisionRound, RevisionRoundView, RevisionTarget } from '../lib/revision-workbench'
import { diffLines } from '../lib/text-diff'
import type { NodeRecord } from '../lib/types'
import { useUnsavedDraft } from '../hooks/useUnsavedDraft'
import { captureProjectSession, isCurrentDocumentSaved, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import type { ProjectSession } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'
import './revision-workbench.css'

const MAX_ENTRIES = 2000
const MAX_CANDIDATE_BYTES = 2 * 1024 * 1024
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const message = (error: unknown) => errorText(error).replace(/^(?:REVISION_CONFLICT|REVISION_CHANGED|EXTERNAL_CONFLICT):/u, '')
const queueLabels = { missing: '待录入改稿', ready: '待确认', blocked: '需复核', changed: '确认后有改动', confirmed: '已确认' } as const
type QueueStatus = keyof typeof queueLabels

function matchesChapter(title: string, order: number | undefined, query: string) {
  const name = title.normalize('NFKC').toLocaleLowerCase()
  const number = /^(?:第\s*)?(\d+)(?:\s*章)?$/u.exec(query)
  if (!number) return name.includes(query)
  const numberedTitle = /^\s*(?:第\s*)?(\d+)(?=\s*章|[.、·\s]|$)/u.exec(name)
  return Number(number[1]) === (numberedTitle ? Number(numberedTitle[1]) : order)
}

function RoundSetup({ nodes, busy, onCreate, onCancel }: {
  nodes: NodeRecord[]; busy: boolean; onCreate: (title: string, ids: string[]) => void; onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [volume, setVolume] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const entries = useMemo(() => sortManuscriptNodes(nodes), [nodes])
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const volumes = nodes.filter(node => node.kind === 'volume').sort((a, b) => a.orderIndex - b.orderIndex)
  const visible = volume ? entries.filter(node => (node.kind === 'section' ? byId.get(node.parentId ?? '')?.parentId : node.parentId) === volume) : entries
  const selectedEntries = entries.filter(node => selected.has(node.id))
  const selectedIds = selectedEntries.map(node => node.id)
  const sectionCount = selectedEntries.filter(node => node.kind === 'section').length
  return <Panel className="revision-setup">
    <h2>新建一轮修订</h2>
    <p className="field-hint">所选原文将作为本轮对比基准。章和小节可分别勾选；按卷全选会同时选中该卷的章和小节。</p>
    <div className="revision-setup-fields">
      <Field label="本轮修订名称"><TextInput value={title} maxLength={100} placeholder="例如：第一卷对白复审" disabled={busy} onChange={event => setTitle(event.target.value)} /></Field>
      <Field label="按卷筛选"><select className="select-input" disabled={busy} value={volume} onChange={event => setVolume(event.target.value)}><option value="">全部卷</option>{volumes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></Field>
    </div>
    <div className="revision-actions">
      <Button variant="outline" disabled={busy || !visible.length} onClick={() => setSelected(previous => new Set([...previous, ...visible.map(node => node.id)]))}>全选当前范围</Button>
      <Button variant="ghost" disabled={busy || !selectedIds.length} onClick={() => setSelected(new Set())}>清空选择</Button>
      <span className="field-hint" role="status">已选 {selectedIds.length - sectionCount} 章 · {sectionCount} 小节{selectedIds.length > MAX_ENTRIES ? '（单轮最多 2000 项）' : ''}</span>
    </div>
    <div className="revision-picker" role="group" aria-label="选择修订章节">
      {visible.length ? visible.map(node => <label key={node.id} className={'revision-picker-row' + (node.kind === 'section' ? ' revision-picker-section' : '')}>
        <input type="checkbox" checked={selected.has(node.id)} disabled={busy} onChange={event => {
          const checked = event.target.checked
          setSelected(previous => { const next = new Set(previous); if (checked) next.add(node.id); else next.delete(node.id); return next })
        }} />
        <span>{node.title}</span><small>{node.kind === 'section' ? '小节 · ' : ''}{byId.get(node.parentId ?? '')?.title}</small>
      </label>) : <p className="field-hint">当前范围内没有正文。</p>}
    </div>
    <div className="revision-actions">
      <Button variant="outline" disabled={busy} onClick={onCancel}>取消</Button>
      <Button disabled={busy || !title.trim() || !selectedIds.length || selectedIds.length > MAX_ENTRIES} onClick={() => onCreate(title, selectedIds)}>建立修订轮次</Button>
    </div>
  </Panel>
}

function RevisionDiff({ original, candidate, latest = false, afterConfirmation = false }: { original: string; candidate: string | null; latest?: boolean; afterConfirmation?: boolean }) {
  const lines = useMemo(() => candidate !== null && [original, candidate].every(value => value.split(/\r\n|\r|\n/u, 801).length <= 800)
    ? diffLines(original.replace(/\r\n?/gu, '\n'), candidate.replace(/\r\n?/gu, '\n'))
    : null, [original, candidate])
  const originalTitle = afterConfirmation ? '本轮确认的正文' : latest ? '当前磁盘正文' : '审阅基准原文'
  const candidateTitle = afterConfirmation ? '当前磁盘正文' : '已保存改稿'
  return <section className="revision-compare">
    <h3>{candidate === null ? originalTitle : `对比：${originalTitle} → ${candidateTitle}`}</h3>
    {candidate === null ? <pre className="revision-text" aria-label={originalTitle}>{original || '（空白正文）'}</pre>
      : lines ? <>
        {candidate === original ? <p className="field-hint">改稿与原文相同，确认只记录审阅进度。</p> : lines.every(line => line.kind === 'same') ? <p className="field-hint">文本相同，换行格式有变化。</p> : <p className="revision-legend"><span className="removed">− {afterConfirmation ? '后续移除' : '原文移除'}</span><span className="added">+ {afterConfirmation ? '后续新增' : '改稿新增'}</span></p>}
        <pre className="revision-text" aria-label={afterConfirmation ? '确认后的正文差异' : '改稿差异'}>{lines.map((line, index) => <span className={line.kind} key={index}>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}{line.text}{'\n'}</span>)}</pre>
      </> : <>
        <p className="field-hint">正文较长，以下展示两份完整正文。</p>
        <div className="revision-text-pair"><div><h4>{originalTitle}</h4><pre className="revision-text" aria-label={originalTitle}>{original}</pre></div><div><h4>{candidateTitle}</h4><pre className="revision-text" aria-label={candidateTitle}>{candidate}</pre></div></div>
      </>}
  </section>
}

function withLineEndings(value: string, template: string) {
  // Textareas return LF; keep uniform CRLF (or CR) used in the source draft.
  const remainder = template.replace(/\r\n/gu, '')
  if (template.includes('\r\n') && !/[\r\n]/u.test(remainder)) return value.replace(/\n/gu, '\r\n')
  if (template.includes('\r') && !template.includes('\n')) return value.replace(/\n/gu, '\r')
  return value
}

async function savePendingManuscript(session: ProjectSession) {
  if (!isCurrentDocumentSaved() && !await useAppStore.getState().saveCurrentDocument('审阅前保存正文')) {
    throw new Error('正文尚未保存。请先处理编辑器中的正文，再继续。')
  }
  if (!isCurrentProjectSession(session) || !isCurrentDocumentSaved()) throw new Error('项目或正文发生变化，请重试。')
}

export function RevisionWorkbench() {
  const path = useAppStore(state => state.projectPath)
  const generation = useAppStore(state => state.projectSession)
  const nodes = useAppStore(state => state.data?.nodes)
  if (!path || !nodes) return null
  if (!isDesktop) return <div className="workspace-view"><div className="view-header"><div><h1>整卷修订</h1><p>请在 NovelForge 桌面版打开项目，建立和继续修订。</p></div></div></div>
  return <ProjectRevisionWorkbench key={`${path}:${generation}`} projectPath={path} nodes={nodes} />
}

function ProjectRevisionWorkbench({ projectPath, nodes }: { projectPath: string; nodes: NodeRecord[] }) {
  const [rounds, setRounds] = useState<RevisionRound[]>([])
  const [view, setView] = useState<RevisionRoundView | null>(null)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [queueFilter, setQueueFilter] = useState<QueueStatus | 'all'>('all')
  const [chapterQuery, setChapterQuery] = useState('')
  const [draftOpen, setDraftOpen] = useState(true)
  const [reviewIssues, setReviewIssues] = useState<Set<string>>(() => new Set())
  const mounted = useRef(false)
  const operation = useRef(false)
  const queue = useRef<HTMLDivElement>(null)
  const scrollRegion = useRef<HTMLDivElement>(null)
  const draftId = 'revision-candidate:' + projectPath
  const current = view?.current
  const dirty = !!current && !current.confirmedAt && draft !== (current.candidate ?? '')
  const stale = !!current && !current.confirmedAt && current.currentContent !== null
  const selectedIndex = view?.chapters.findIndex(item => item.nodeId === current?.nodeId) ?? -1
  const selected = view?.chapters[selectedIndex]
  const entryLabel = selected?.kind === 'section' ? '本节' : '本章'
  const changedAfterConfirmation = current?.confirmationState === 'changed'
  const chapterOrders = useMemo(() => new Map(sortChapterNodes(nodes).map((node, index) => [node.id, index + 1])), [nodes])

  const rememberIssue = useCallback((roundId: string, chapter: RevisionChapter) => {
    const key = roundId + ':' + chapter.nodeId
    const blocked = !chapter.confirmedAt && (chapter.currentContent !== null || Boolean(chapter.sourceIssue))
    setReviewIssues(previous => {
      if (previous.has(key) === blocked) return previous
      const next = new Set(previous)
      if (blocked) next.add(key); else next.delete(key)
      return next
    })
  }, [])
  const install = useCallback((next: RevisionRoundView) => {
    setView(previous => {
      if (previous?.round.id !== next.round.id) return next
      const prior = new Map(previous.chapters.map(item => [item.nodeId, item]))
      return { ...next, chapters: next.chapters.map(item => {
        const known = prior.get(item.nodeId)
        return item.confirmedAt && item.confirmationState === null && known?.confirmedAt === item.confirmedAt
          ? { ...item, confirmationState: known.confirmationState }
          : item
      }) }
    })
    setRounds(previous => [next.round, ...previous.filter(round => round.id !== next.round.id)])
    setDraft(next.current.candidate ?? '')
    setDraftOpen(next.current.candidate === null)
    rememberIssue(next.round.id, next.current)
    markDraftSaved(draftId)
  }, [draftId, rememberIssue])

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLayoutEffect(() => {
    if (scrollRegion.current) scrollRegion.current.scrollTop = 0
  }, [creating, current?.nodeId, view?.round.id])
  useLayoutEffect(() => {
    const list = queue.current
    const row = list?.querySelector('[aria-current="step"]')
    if (!list || !row) return
    const bounds = list.getBoundingClientRect()
    const selectedBounds = row.getBoundingClientRect()
    if (selectedBounds.top < bounds.top) list.scrollTop -= bounds.top - selectedBounds.top
    else if (selectedBounds.bottom > bounds.bottom) list.scrollTop += selectedBounds.bottom - bounds.bottom
  }, [creating, current?.nodeId, queueFilter, chapterQuery])
  useEffect(() => {
    let alive = true
    const session = captureProjectSession()
    const currentSession = () => alive && isCurrentProjectSession(session)
    async function load() {
      setLoading(true)
      setError('')
      try {
        const list = await projectApi.revisionRounds(projectPath)
        if (!currentSession()) return
        setRounds(list)
        if (list[0]) {
          const next = await projectApi.openRevisionRound({ projectPath, roundId: list[0].id })
          if (currentSession()) install(next)
        }
      } catch (e) { if (currentSession()) setError(message(e)) }
      finally { if (currentSession()) setLoading(false) }
    }
    void load()
    return () => { alive = false }
  }, [install, projectPath, retry])

  function active(session: ProjectSession) { return mounted.current && isCurrentProjectSession(session) }
  async function run(action: (session: ProjectSession) => Promise<void>) {
    if (operation.current) return false
    const session = captureProjectSession()
    if (!active(session) || session.path !== projectPath) return false
    operation.current = true
    setDraftSaving(draftId, true)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(session)
      return active(session)
    } catch (e) {
      if (active(session)) setError(message(e))
      return false
    } finally {
      operation.current = false
      setDraftSaving(draftId, false)
      if (active(session)) setBusy(false)
    }
  }

  function target(): RevisionTarget | null {
    return view && current ? { projectPath, roundId: view.round.id, nodeId: current.nodeId, expectedVersion: current.version } : null
  }

  function updateChapter(next: RevisionChapter) {
    setView(previous => previous && {
      ...previous, current: next,
      chapters: previous.chapters.map(item => item.nodeId === next.nodeId ? { ...item, hasCandidate: next.candidate !== null } : item),
    })
    setDraft(next.candidate ?? '')
    setDraftOpen(next.candidate === null)
    if (view) rememberIssue(view.round.id, next)
    markDraftSaved(draftId)
  }

  async function saveCandidate() {
    const input = target()
    if (!input || current?.confirmedAt) return false
    if (!dirty) return true
    return run(async session => {
      const next = await projectApi.saveRevisionCandidate(input, draft)
      if (!active(session)) return
      updateChapter(next)
      setNotice(next.candidate === null ? '已清除本章改稿。' : '改稿已保存。请核对下方差异。')
    })
  }
  useUnsavedDraft(draftId, entryLabel + '改稿', dirty, saveCandidate, () => setDraft(current?.candidate ?? ''))

  function openRound(roundId: string, nodeId?: string) {
    runGuarded(() => { void run(async session => {
      const next = await projectApi.openRevisionRound({ projectPath, roundId, nodeId })
      if (!active(session)) return
      install(next)
      if (roundId !== view?.round.id) { setQueueFilter('all'); setChapterQuery('') }
      setCreating(false)
    }) })
  }

  async function loadCandidate(file: File) {
    await run(async session => {
      if (!/\.(?:txt|md|markdown)$/iu.test(file.name) || file.size > MAX_CANDIDATE_BYTES) throw new Error('请选择不超过 2 MiB 的 TXT 或 Markdown 改稿。')
      const { text } = decodeManuscript(new Uint8Array(await file.arrayBuffer()))
      if (!active(session)) return
      setDraft(text)
      setNotice('已载入改稿。保存后即可对比。')
    })
  }

  async function refreshConflict(input: RevisionTarget, session: ProjectSession, e: unknown): Promise<null> {
    if (/^(?:REVISION_CONFLICT|EXTERNAL_CONFLICT):/u.test(errorText(e)) && active(session)) {
      const next = await projectApi.openRevisionRound({ projectPath, roundId: input.roundId, nodeId: input.nodeId })
      if (active(session)) {
        install(next)
        if (next.current.currentContent !== null || next.current.sourceIssue) return null
      }
    }
    throw e
  }

  function rebase() {
    const input = target()
    const seen = current?.currentContent
    if (!input || seen === undefined || seen === null || dirty || current?.sourceIssue) return
    void run(async session => {
      const next = await projectApi.rebaseRevisionChapter(input, seen).catch(e => refreshConflict(input, session, e))
      if (!next || !active(session)) return
      updateChapter(next)
      setNotice('已改用当前正文作为基准。请重新核对差异后确认。')
    })
  }

  function confirm() {
    const input = target()
    if (!input || !view || !current?.candidate || current.confirmedAt || dirty || stale || current.sourceIssue) return
    void run(async session => {
      await savePendingManuscript(session)
      const documentVersion = useAppStore.getState().documentVersion
      const result = await projectApi.confirmRevisionChapter(input).catch(e => refreshConflict(input, session, e))
      if (!result || !active(session)) return
      const updated = result.document
      if (updated) {
        useAppStore.setState(state => ({
          data: state.data && { ...state.data, nodes: state.data.nodes.map(node => node.id === updated.node.id ? updated.node : node) },
          // An editor left open behind the workbench must use the applied draft
          // as its persisted baseline, but any new editor input wins in memory.
          ...(state.document?.node.id === updated.node.id && state.documentVersion === documentVersion && state.saveState === 'saved'
            ? { document: { ...updated, persistedContent: updated.content }, documentVersion: documentVersion + 1, editorSelection: null }
            : {}),
        }))
        historyChanged()
        void useAppStore.getState().refreshStats()
      }
      const round = { ...view.round, confirmedCount: view.round.confirmedCount + 1 }
      install({
        round,
        current: { ...current, confirmedAt: result.confirmedAt, version: result.version, confirmationState: 'current' },
        chapters: view.chapters.map(item => item.nodeId === input.nodeId ? { ...item, confirmedAt: result.confirmedAt, confirmationState: 'current' } : item),
      })
      setNotice(updated ? entryLabel + '已确认并写入正文。原文可在版本历史中查看。' : entryLabel + '已确认，正文无变化。')
    })
  }

  const ready = !busy && !loading
  const statuses = (view?.chapters ?? []).map(item => {
    const status: QueueStatus = !item.available || item.confirmationState === 'unavailable' || reviewIssues.has(view!.round.id + ':' + item.nodeId) ? 'blocked'
      : item.confirmationState === 'changed' ? 'changed'
      : item.confirmedAt ? 'confirmed'
      : item.hasCandidate ? 'ready' : 'missing'
    return { ...item, status }
  })
  const lookup = chapterQuery.trim().normalize('NFKC').toLocaleLowerCase()
  const visibleQueue = statuses.filter(item => (queueFilter === 'all' || item.status === queueFilter) && matchesChapter(item.title, chapterOrders.get(item.nodeId), lookup))
  const upcoming = [...statuses.slice(selectedIndex + 1), ...statuses.slice(0, selectedIndex)]
  const nextReady = upcoming.find(item => item.status === 'ready')
  const nextMissing = upcoming.find(item => item.status === 'missing')
  const readyToApply = ready && !dirty && !stale && Boolean(current?.candidate) && !current?.sourceIssue
  const reviewedIds = new Set(statuses.map(item => item.nodeId))
  const chapterCount = statuses.filter(item => item.kind === 'chapter').length
  const sectionCount = statuses.filter(item => item.kind === 'section').length
  const excludedSections = nodes.filter(node => node.kind === 'section' && node.parentId && reviewedIds.has(node.parentId) && !reviewedIds.has(node.id)).length
  const changedCount = statuses.filter(item => item.status === 'changed').length
  const applyHint = changedAfterConfirmation ? '本轮确认后正文有改动。'
    : current?.confirmationState === 'unavailable' ? '本轮曾确认，当前无法读取正文。'
    : current?.confirmedAt ? '本轮已确认' + entryLabel + '。'
    : current?.sourceIssue ? '请先处理' + entryLabel + '的正文问题。'
    : stale ? '原文已变化，请重新对比后确认。'
    : dirty ? '请先保存' + entryLabel + '改稿。'
    : !current?.candidate ? '保存改稿后可以确认' + entryLabel + '。'
    : '有变化时，应用前会保留原文版本。'
  return <div className="workspace-view revision-workbench">
    <div className="revision-scroll" ref={scrollRegion}>
    <header className="view-header"><div><p className="eyebrow">MANUSCRIPT REVIEW</p><h1>整卷修订</h1><p>选择章或小节，保存改稿并逐项确认。回到本页时继续上次的审阅位置。</p></div>
      <Button variant="outline" disabled={!ready || creating} onClick={() => runGuarded(() => { setError(''); setNotice(''); setCreating(true) })}><Plus size={15} />新建修订</Button>
    </header>
    <div className="revision-body">
      {loading && <p role="status" className="field-hint">正在读取修订进度…</p>}
      {error && <div className="revision-alert" role="alert">{error}{!view && !creating && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>重试</Button>}</div>}
      {notice && <p className="revision-notice" role="status">{notice}</p>}
      {creating ? <RoundSetup nodes={nodes} busy={busy} onCancel={() => { setCreating(false); setError('') }} onCreate={(title, nodeIds) => { void run(async session => {
        await savePendingManuscript(session)
        const next = await projectApi.createRevisionRound({ projectPath, title, nodeIds })
        if (!active(session)) return
        install(next)
        setQueueFilter('all')
        setChapterQuery('')
        setCreating(false)
        setNotice(`已建立修订轮次，共 ${next.round.chapterCount} 项。`)
      }) }} /> : view && current && selected ? <>
        <Panel className="revision-round-bar">
          <Field label="修订轮次"><select className="select-input" value={view.round.id} disabled={!ready} onChange={event => openRound(event.target.value)}>{rounds.map(round => <option value={round.id} key={round.id}>{round.title}（{round.confirmedCount}/{round.chapterCount}）</option>)}</select></Field>
          <div className="revision-progress">
            <strong>已确认 {view.round.confirmedCount} / {view.round.chapterCount} 项{changedCount > 0 && <span className="revision-changed"> · {changedCount} 项确认后有改动</span>}</strong>
            <progress aria-label="修订进度" value={view.round.confirmedCount} max={view.round.chapterCount} />
            <span>本轮范围：{chapterCount} 章 · {sectionCount} 小节{excludedSections > 0 && `；所选章还有 ${excludedSections} 个小节未纳入`}</span>
            <div><Button variant="ghost" disabled={!ready} onClick={() => openRound(view.round.id)}><RefreshCw size={14} />检查本轮正文</Button></div>
          </div>
        </Panel>
        <div className="revision-grid">
          <Panel className="revision-queue">
            <div className="revision-queue-head"><h2>审阅队列</h2><small>{visibleQueue.length} / {statuses.length} 项</small></div>
            <div className="revision-queue-filters">
              <TextInput type="search" aria-label="查找修订章节" placeholder="章号、章名或小节名" value={chapterQuery} onChange={event => setChapterQuery(event.target.value)} />
              <select className="select-input" aria-label="筛选修订队列" value={queueFilter} onChange={event => setQueueFilter(event.target.value as QueueStatus | 'all')}>
                <option value="all">全部条目</option>
                {Object.entries(queueLabels).map(([value, label]) => <option key={value} value={value}>{label}（{statuses.filter(item => item.status === value).length}）</option>)}
              </select>
            </div>
            <div ref={queue} className="revision-queue-list" aria-label="本轮修订章节">
              {visibleQueue.map(item => <button type="button" className="revision-queue-item" key={item.nodeId} aria-current={item.nodeId === current.nodeId ? 'step' : undefined} disabled={!ready} onClick={() => { if (item.nodeId !== current.nodeId) openRound(view.round.id, item.nodeId) }}>
                <span>{item.title}</span><small className={'revision-queue-status ' + item.status}>{item.kind === 'section' ? '小节 · ' : ''}{!item.available ? '正文不可用' : queueLabels[item.status]}</small>
              </button>)}
              {!visibleQueue.length && <p className="field-hint revision-queue-empty">没有符合条件的章节。</p>}
            </div>
          </Panel>
          <Panel className="revision-detail">
            <div className="revision-detail-head"><div><p className="eyebrow">第 {selectedIndex + 1} / {view.chapters.length} 项 · {selected.kind === 'section' ? '小节' : '章节'}</p><h2>{selected.title}</h2></div>
              <div className="revision-actions">
                <Button variant="ghost" disabled={!ready || selectedIndex <= 0} onClick={() => openRound(view.round.id, view.chapters[selectedIndex - 1].nodeId)}><ArrowLeft size={14} />上一项</Button>
              </div>
            </div>
            {current.sourceIssue && <p className="revision-alert" role="alert">{current.sourceIssue}</p>}
            {changedAfterConfirmation && <p className="revision-alert" role="alert">本轮确认后正文有改动。下方对比本轮确认的正文和当前正文；如需确认新内容，请建立新的修订轮次。</p>}
            {stale && <div className="revision-alert" role="alert"><span>原文已变化，已暂停应用。本页显示当前磁盘正文与保存的改稿。</span><Button variant="outline" disabled={!ready || dirty || !!current.sourceIssue} onClick={rebase}>以当前正文重新对比</Button></div>}
            <div className="revision-actions">
              <Button variant="ghost" disabled={!ready || !selected.available} onClick={() => void useAppStore.getState().selectNode(current.nodeId, true)}>打开正文</Button>
              <Button variant="ghost" disabled={!ready} onClick={() => openRound(view.round.id, current.nodeId)}><RefreshCw size={14} />刷新原文</Button>
            </div>
            {changedAfterConfirmation
              ? <RevisionDiff original={current.candidate ?? current.original} candidate={current.currentContent} afterConfirmation />
              : <RevisionDiff original={stale ? current.currentContent! : current.original} candidate={current.candidate} latest={stale} />}
            {!current.confirmedAt ? <details className="revision-draft-editor" open={draftOpen} onToggle={event => setDraftOpen(event.currentTarget.open)}>
              <summary>{current.candidate === null ? '录入改稿' : '编辑改稿'}{dirty && <small>未保存</small>}</summary>
              <div className="revision-draft-fields">
              <Field label={entryLabel + '改稿'} hint={dirty ? '改稿尚未保存。保存后，差异对比会更新。' : '可粘贴改稿或载入 TXT / Markdown。保存改稿后，原正文仍可继续编辑。'}>
                <textarea className="text-area revision-candidate" value={draft} disabled={!ready} onChange={event => setDraft(withLineEndings(event.target.value, draft || current.original))} />
              </Field>
              <div className="revision-actions">
                <Button variant="ghost" disabled={!ready || !!draft} onClick={() => setDraft(current.currentContent ?? current.original)}>用原文起稿</Button>
                <label className="revision-file">载入改稿文件<input type="file" accept=".txt,.md,.markdown" disabled={!ready || dirty} onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void loadCandidate(file)
                }} /></label>
                <Button variant="outline" disabled={!ready || !dirty} onClick={() => void saveCandidate()}><Save size={14} />保存改稿</Button>
              </div>
              </div>
            </details> : null}
          </Panel>
        </div>
      </> : !loading && !error && <Panel className="revision-empty"><GitCompare size={26} /><div><h2>还没有修订轮次</h2><p className="field-hint">点击「新建修订」，选择这次要对比和确认的章节。</p></div></Panel>}
    </div>
    </div>
    {!creating && view && current && selected && <footer className="revision-actionbar" aria-label="审阅操作">
      <div className="revision-confirm">
        {!current.confirmedAt && <Button disabled={!readyToApply} onClick={confirm}><FileCheck2 size={15} />{current.candidate === current.original ? '确认' + entryLabel + '无改动' : '确认并应用' + entryLabel}</Button>}
        <span className="field-hint">{applyHint}</span>
      </div>
      <div className="revision-actions">
        <Button variant="ghost" disabled={!ready || !nextMissing} onClick={() => { if (nextMissing) openRound(view.round.id, nextMissing.nodeId) }}>下一待录入</Button>
        <Button variant="outline" disabled={!ready || !nextReady} onClick={() => { if (nextReady) openRound(view.round.id, nextReady.nodeId) }}>下一待确认<ArrowRight size={14} /></Button>
      </div>
    </footer>}
  </div>
}
