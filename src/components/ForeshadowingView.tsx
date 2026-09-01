import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { BookOpen, CheckCircle2, CircleDashed, GitBranch, Plus, Save, Search, Trash2 } from 'lucide-react'
import type { EntityRecord, NodeRecord } from '../lib/types'
import {
  chapterReferenceTokens, contentText, findChapterByReference, FORESHADOWING_STATUSES,
  foreshadowingStatusLabel, isOpenForeshadowingStatus, normalizeForeshadowingStatus,
} from '../lib/planning-data'
import type { ForeshadowingStatus } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { Button, Field, Panel, TextInput } from './ui'
import { useContextMenu } from './ContextMenu'
import '../planning.css'

interface ForeshadowingDraft {
  title: string
  description: string
  plantedIn: string
  plannedPayoff: string
  actualPayoff: string
  status: ForeshadowingStatus
  notes: string
}

function blankDraft(): ForeshadowingDraft {
  return { title: '', description: '', plantedIn: '', plannedPayoff: '', actualPayoff: '', status: 'planned', notes: '' }
}

function toDraft(entity: EntityRecord | undefined) {
  const draft = blankDraft()
  if (!entity) return draft
  draft.title = entity.title
  draft.description = contentText(entity, 'description')
  draft.plantedIn = contentText(entity, 'plantedIn')
  draft.plannedPayoff = contentText(entity, 'plannedPayoff')
  draft.actualPayoff = contentText(entity, 'actualPayoff')
  draft.status = normalizeForeshadowingStatus(contentText(entity, 'status'))
  draft.notes = contentText(entity, 'notes')
  return draft
}

function statusIcon(status: ForeshadowingStatus) {
  if (status === 'paid-off') return CheckCircle2
  if (status === 'planted') return GitBranch
  return CircleDashed
}

function ChapterReferences({ value, nodes, onOpen }: {
  value: string
  nodes: NodeRecord[]
  onOpen: (id: string) => void
}) {
  const references = chapterReferenceTokens(value)
  if (!references.length) return <span className="planning-reference-empty">未关联章节</span>
  return <div className="planning-reference-list">{references.map((reference) => {
    const chapter = findChapterByReference(nodes, reference)
    return chapter
      ? <button key={reference} type="button" className="planning-reference" onClick={() => onOpen(chapter.id)}><BookOpen size={11} />{chapter.title}</button>
      : <span key={reference} className="planning-reference missing">{reference}</span>
  })}</div>
}

export function ForeshadowingView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const selectNode = useAppStore((state) => state.selectNode)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<ForeshadowingStatus | 'all'>('all')
  const [draft, setDraft] = useState<ForeshadowingDraft>(blankDraft)
  const [busy, setBusy] = useState(false)

  const entries = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'foreshadowing'), [data?.entities])
  const visibleEntries = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return entries.filter((entry) => {
      const statusMatches = statusFilter === 'all' || normalizeForeshadowingStatus(contentText(entry, 'status')) === statusFilter
      const textMatches = !query || [entry.title, contentText(entry, 'description'), contentText(entry, 'plantedIn'), contentText(entry, 'plannedPayoff'), contentText(entry, 'actualPayoff'), contentText(entry, 'notes')]
        .join(' ').toLocaleLowerCase().includes(query)
      return statusMatches && textMatches
    })
  }, [entries, filter, statusFilter])
  const selected = entries.find((entry) => entry.id === selectedId)
  const counts = useMemo(() => Object.fromEntries(FORESHADOWING_STATUSES.map((status) => [
    status.id, entries.filter((entry) => normalizeForeshadowingStatus(contentText(entry, 'status')) === status.id).length,
  ])) as Record<ForeshadowingStatus, number>, [entries])

  useEffect(() => {
    if (!creating && selectedId && !selected) setSelectedId(entries[0]?.id ?? null)
    if (!creating && !selectedId && entries.length) setSelectedId(entries[0].id)
  }, [creating, entries, selected, selectedId])

  useEffect(() => {
    setDraft(creating ? blankDraft() : toDraft(selected))
  }, [creating, selected])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: keyof ForeshadowingDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function startNew() {
    setCreating(true)
    setSelectedId(null)
  }

  async function save() {
    if (!draft.title.trim()) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'foreshadowing',
        id: creating ? null : selected?.id ?? null,
        title: draft.title.trim(),
        content: {
          description: draft.description,
          plantedIn: draft.plantedIn.trim(),
          plannedPayoff: draft.plannedPayoff.trim(),
          actualPayoff: draft.actualPayoff.trim(),
          status: draft.status,
          notes: draft.notes,
        },
        tags: ['伏笔', foreshadowingStatusLabel(draft.status)],
      })
      const refreshed = useAppStore.getState().data?.entities ?? []
      const saved = creating
        ? refreshed.filter((entity) => entity.kind === 'foreshadowing' && entity.title === draft.title.trim()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
        : selected
      setCreating(false)
      setSelectedId(saved?.id ?? null)
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function updateStatus(entry: EntityRecord, status: ForeshadowingStatus) {
    if (normalizeForeshadowingStatus(contentText(entry, 'status')) === status) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath, kind: 'foreshadowing', id: entry.id, title: entry.title,
        content: { ...entry.content, status }, tags: ['伏笔', foreshadowingStatusLabel(status)],
      })
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected || !window.confirm('将“' + selected.title + '”移入回收站？')) return
    try {
      await deleteEntity(selected.id)
      setSelectedId(null)
    } catch (error) {
      setError(error)
    }
  }

  function openForeshadowingMenu(event: ReactMouseEvent<HTMLDivElement>, item: EntityRecord) {
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'foreshadowing-open', label: '打开／编辑', onSelect: () => { setCreating(false); setSelectedId(item.id) } },
      { type: 'item', id: 'foreshadowing-new', label: '新建同类资料', icon: Plus, onSelect: startNew },
      { type: 'item', id: 'foreshadowing-copy-title', label: '复制标题', onSelect: async () => { if (!await writeClipboardText(item.title)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'item', id: 'foreshadowing-copy-path', label: '复制 Markdown 路径', onSelect: async () => { if (!await writeClipboardText(item.filePath)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'separator' },
      { type: 'item', id: 'foreshadowing-trash', label: '移入回收站', icon: Trash2, tone: 'danger', onSelect: async () => { if (window.confirm('将“' + item.title + '”移入回收站？')) { await deleteEntity(item.id); if (selectedId === item.id) setSelectedId(null) } } },
    ]
    openContextMenu(event, { title: item.title, location: 'workspace', payload: { location: 'workspace', projectPath: currentProjectPath, entityId: item.id, entityKind: 'foreshadowing' }, items, trigger: event.currentTarget })
  }

  return <div className="planning-special-view workspace-view">
    <div className="view-header">
      <div><p className="eyebrow">FORESHADOWING LEDGER</p><h1>伏笔</h1><p>记录伏笔的埋设、计划回收和实际回收，写作时快速检查仍未闭合的线索。</p></div>
      <div className="special-summary"><strong>{entries.filter((entry) => isOpenForeshadowingStatus(contentText(entry, 'status'))).length}</strong><span>条待跟进</span></div>
    </div>
    <div className="foreshadowing-status-bar">{FORESHADOWING_STATUSES.map((status) => <button key={status.id} type="button" className={'foreshadowing-status-chip ' + (statusFilter === status.id ? 'active ' : '') + status.id} onClick={() => setStatusFilter(statusFilter === status.id ? 'all' : status.id)}><span>{status.label}</span><strong>{counts[status.id]}</strong></button>)}</div>
    <div className="special-toolbar">
      <div className="special-search"><Search size={14} /><TextInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索伏笔、章节或说明" /></div>
      <Button onClick={startNew}><Plus size={14} />新建伏笔</Button>
    </div>
    <div className="special-layout">
      <aside className="special-list-pane">
        <div className="special-list-head"><div className="panel-title"><h3>伏笔清单</h3><span>{visibleEntries.length} / {entries.length}</span></div><p>点击状态徽标可筛选；列表按最近修改排序。</p></div>
        <div className="special-list">{visibleEntries.length ? visibleEntries.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((entry) => {
          const status = normalizeForeshadowingStatus(contentText(entry, 'status'))
          const Icon = statusIcon(status)
          return <div key={entry.id} className={'special-list-item foreshadowing-item' + (entry.id === selectedId && !creating ? ' active' : '')} onContextMenu={(event) => openForeshadowingMenu(event, entry)}>
            <button type="button" className="special-list-main" onClick={() => { setCreating(false); setSelectedId(entry.id) }}><span className={'special-list-icon ' + status}><Icon size={14} /></span><span className="special-list-copy"><strong>{entry.title}</strong><small>{foreshadowingStatusLabel(status)} · 首次：{contentText(entry, 'plantedIn') || '未填写'}</small><em>{contentText(entry, 'description') || '尚未填写说明'}</em></span></button>
            <select className={'foreshadowing-status-select ' + status} value={status} disabled={busy} aria-label={entry.title + '状态'} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateStatus(entry, event.target.value as ForeshadowingStatus)}>{FORESHADOWING_STATUSES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          </div>
        }) : <div className="empty-state"><GitBranch size={24} /><div><strong>{filter || statusFilter !== 'all' ? '没有匹配伏笔' : '还没有伏笔记录'}</strong><span>{filter || statusFilter !== 'all' ? '换一个关键词或状态试试。' : '把需要在后文回应的线索记录下来，避免长篇写作中遗忘。'}</span></div></div>}</div>
      </aside>
      <section className="special-editor">
        <Panel className="special-card">{creating || selected ? <><div className="planning-card-head"><div><p className="eyebrow">THREAD DETAIL</p><h3>{creating ? '新建伏笔' : selected?.title}</h3></div><span className={'planning-state ' + draft.status}>{busy ? '保存中…' : foreshadowingStatusLabel(draft.status)}</span></div>
          <div className="planning-form">
            <Field label="伏笔标题"><TextInput autoFocus={creating} value={draft.title} onChange={(event) => updateField('title', event.target.value)} placeholder="例如：钟楼里缺失的第十三口钟" /></Field>
            <Field label="伏笔说明"><textarea className="text-area" value={draft.description} onChange={(event) => updateField('description', event.target.value)} placeholder="记录读者已经看到的线索、隐藏信息和预期效果…" /></Field>
            <div className="field-grid"><Field label="首次埋设章节"><TextInput value={draft.plantedIn} onChange={(event) => updateField('plantedIn', event.target.value)} placeholder="例如：第 2 章" /><ChapterReferences value={draft.plantedIn} nodes={data.nodes} onOpen={(id) => void selectNode(id)} /></Field><Field label="计划回收章节"><TextInput value={draft.plannedPayoff} onChange={(event) => updateField('plannedPayoff', event.target.value)} placeholder="例如：第 18 章" /><ChapterReferences value={draft.plannedPayoff} nodes={data.nodes} onOpen={(id) => void selectNode(id)} /></Field></div>
            <div className="field-grid"><Field label="实际回收章节"><TextInput value={draft.actualPayoff} onChange={(event) => updateField('actualPayoff', event.target.value)} placeholder="回收后填写" /><ChapterReferences value={draft.actualPayoff} nodes={data.nodes} onOpen={(id) => void selectNode(id)} /></Field><Field label="状态"><select className="select-input" value={draft.status} onChange={(event) => updateField('status', event.target.value)}>{FORESHADOWING_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label} · {status.description}</option>)}</select></Field></div>
            <Field label="备注"><textarea className="text-area compact" value={draft.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="补充写作提醒、相关人物或需要检查的章节…" /></Field>
            <div className="entity-actions"><Button onClick={() => void save()} disabled={busy || !draft.title.trim()}><Save size={14} />{busy ? '保存中…' : '保存伏笔'}</Button>{selected && !creating ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div>
          </div>
        </> : <div className="empty-state"><GitBranch size={25} /><div><strong>选择一条伏笔</strong><span>从左侧选择伏笔，或新建一条需要后续回收的线索。</span></div></div>}</Panel>
      </section>
    </div>
  </div>
}
