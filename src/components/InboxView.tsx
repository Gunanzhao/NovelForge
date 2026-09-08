import { useUnsavedDraft } from '../hooks/useUnsavedDraft'
import { markDraftSaved, runGuarded } from '../lib/draft-guard'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArchiveRestore, CheckCircle2, Inbox, Lightbulb, Plus, Search, Trash2 } from 'lucide-react'
import {
  appendInboxMilestone, inboxConversionInput, inboxEntityContent, INBOX_CONVERSIONS, parseInboxItem,
} from '../lib/inbox-data'
import type { InboxConversionKind, InboxItem } from '../lib/inbox-data'
import { parseStoryArc, storyArcEntityInputContent } from '../lib/story-arc-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Modal, Panel, TextInput } from './ui'

function generatedTitle(content: string) {
  const firstLine = content.trim().split(/\r?\n/u)[0]?.slice(0, 24).trim()
  return firstLine || `灵感 ${new Date().toLocaleString('zh-CN')}`
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function QuickInboxCapture() {
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const setError = useAppStore((state) => state.setError)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const draftId = 'quick-inbox:' + projectPath
  useUnsavedDraft(draftId, '快速灵感', Boolean(title || content || tags), save, () => { setTitle(''); setContent(''); setTags('') })

  useEffect(() => {
    const show = () => { if (useAppStore.getState().projectPath) setOpen(true) }
    window.addEventListener('novelforge:quick-inbox', show)
    return () => window.removeEventListener('novelforge:quick-inbox', show)
  }, [])

  if (!projectPath) return null
  const currentProjectPath = projectPath
  async function save() {
    if (!content.trim()) return false
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'inbox',
        id: null,
        title: title.trim() || generatedTitle(content),
        content: inboxEntityContent({ content: content.trim(), processed: false }),
        tags: tags.split(/[,，、]/u).map((tag) => tag.trim()).filter(Boolean),
      })
      setTitle('')
      setContent('')
      setTags('')
      setOpen(false)
      markDraftSaved(draftId)
      return true
    } catch (error) {
      setError(error); return false
    } finally {
      setBusy(false)
    }
  }
  return <Modal open={open} title="快速记录灵感" onClose={() => runGuarded(() => setOpen(false))} footer={<><Button variant="outline" onClick={() => runGuarded(() => setOpen(false))}>取消</Button><Button disabled={busy || !content.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存灵感'}</Button></>}><div className="inbox-capture-form"><Field label="标题（可选）"><TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="留空时使用正文第一行" /></Field><Field label="正文"><textarea autoFocus className="text-area" value={content} onChange={(event) => setContent(event.target.value)} placeholder="先记下来，稍后整理…" /></Field><Field label="标签"><TextInput value={tags} onChange={(event) => setTags(event.target.value)} placeholder="使用逗号分隔" /></Field></div></Modal>
}

export function InboxView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const setView = useAppStore((state) => state.setView)
  const setError = useAppStore((state) => state.setError)
  const [tab, setTab] = useState<'pending' | 'processed'>('pending')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [arcId, setArcId] = useState('')
  const [conversionKind, setConversionKind] = useState<InboxConversionKind | 'story-arc-milestone'>('character')
  const [detailOpen, setDetailOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const items = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'inbox').map(parseInboxItem), [data?.entities])
  const arcs = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'story-arc'), [data?.entities])
  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort((left, right) => left.localeCompare(right, 'zh-CN')), [items])
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return items.filter((item) => item.processed === (tab === 'processed'))
      .filter((item) => !normalized || `${item.title}\n${item.content}\n${item.tags.join(' ')}`.toLocaleLowerCase().includes(normalized))
      .filter((item) => !tag || item.tags.includes(tag))
      .sort((left, right) => sort === 'newest' ? right.createdAt.localeCompare(left.createdAt) : left.createdAt.localeCompare(right.createdAt))
  }, [items, query, sort, tab, tag])
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0]
  useEffect(() => {
    const quick = () => window.dispatchEvent(new Event('novelforge:quick-inbox'))
    window.addEventListener('novelforge:new-inbox-item', quick)
    return () => window.removeEventListener('novelforge:new-inbox-item', quick)
  }, [])
  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  async function markProcessed(item: InboxItem, processedInto: InboxItem['processedInto']) {
    await saveEntity({
      projectPath: currentProjectPath,
      kind: 'inbox',
      id: item.id,
      title: item.title,
      content: inboxEntityContent({ ...item, processed: true, processedInto }),
      tags: item.tags,
    })
  }

  async function convert(item: InboxItem, kind: InboxConversionKind) {
    setBusy(true)
    const beforeIds = new Set(useAppStore.getState().data?.entities.map((entity) => entity.id) ?? [])
    let createdId = ''
    try {
      await saveEntity(inboxConversionInput(currentProjectPath, item, kind))
      createdId = useAppStore.getState().data?.entities.find((entity) => entity.kind === kind && !beforeIds.has(entity.id))?.id ?? ''
      if (!createdId) throw new Error('目标资料创建后无法确认 ID，已停止标记灵感。')
      await markProcessed(item, { kind, id: createdId })
    } catch (error) {
      if (createdId) {
        try { await deleteEntity(createdId) } catch { /* 原灵感仍未处理，目标会保留供用户核对。 */ }
      }
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function convertToMilestone(item: InboxItem) {
    const arc = arcs.find((candidate) => candidate.id === arcId)
    if (!arc) { setError('请先选择一条剧情线。'); return }
    const previous = parseStoryArc(arc)
    const milestoneId = newId()
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'story-arc',
        id: arc.id,
        title: arc.title,
        content: appendInboxMilestone(arc, item, milestoneId),
        tags: arc.tags,
      })
      try {
        await markProcessed(item, { kind: 'story-arc-milestone', id: `${arc.id}:${milestoneId}` })
      } catch (error) {
        await saveEntity({
          projectPath: currentProjectPath,
          kind: 'story-arc',
          id: arc.id,
          title: arc.title,
          content: storyArcEntityInputContent(previous),
          tags: arc.tags,
        })
        throw error
      }
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  const capture = () => window.dispatchEvent(new Event('novelforge:quick-inbox'))
  const clearFilters = () => { setQuery(''); setTag(''); setDetailOpen(false) }
  const hasFilters = Boolean(query.trim() || tag)
  const selectedConversionLabel = selected?.processedInto?.kind === 'story-arc-milestone'
    ? '剧情线节点'
    : INBOX_CONVERSIONS.find((item) => item.kind === selected?.processedInto?.kind)?.label.replace('转为', '')

  async function markOnly(item: InboxItem) {
    setBusy(true)
    try { await markProcessed(item, undefined) } catch (error) { setError(error) } finally { setBusy(false) }
  }

  return <div className="workspace-view inbox-view">
    <div className="view-header inbox-header">
      <div><h1>灵感箱</h1><p>随手捕捉想法，稍后整理到故事中。</p></div>
      <div className="view-actions"><Button variant="ghost" onClick={() => setView('trash')}><ArchiveRestore size={14} />回收站</Button><Button onClick={capture} title="快速记录灵感 · Ctrl+Shift+I"><Plus size={14} />快速记录<kbd>Ctrl+Shift+I</kbd></Button></div>
    </div>
    <div className="inbox-toolbar">
      <div className="planning-tabs" aria-label="灵感状态">
        <button aria-pressed={tab === 'pending'} className={tab === 'pending' ? 'active' : ''} onClick={() => { setTab('pending'); setDetailOpen(false) }}>未整理 ({items.filter((item) => !item.processed).length})</button>
        <button aria-pressed={tab === 'processed'} className={tab === 'processed' ? 'active' : ''} onClick={() => { setTab('processed'); setDetailOpen(false) }}>已整理 ({items.filter((item) => item.processed).length})</button>
      </div>
      <div className="inbox-filters">
        <label className="inbox-search"><Search size={15} /><TextInput aria-label="搜索灵感" value={query} onChange={(event) => { setQuery(event.target.value); setDetailOpen(false) }} placeholder="搜索灵感…" /></label>
        <select className="select-input" value={tag} onChange={(event) => { setTag(event.target.value); setDetailOpen(false) }} aria-label="灵感标签过滤"><option value="">全部标签</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select className="select-input" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="灵感时间排序"><option value="newest">最新优先</option><option value="oldest">最早优先</option></select>
      </div>
    </div>
    {!items.length ? <div className="inbox-empty inbox-first-empty"><div className="inbox-empty-icon"><Lightbulb size={30} /></div><h2>记下第一个灵感</h2><p>一句对白、一个人物，或一个尚未成形的转折。<br />先记下来，稍后再整理。</p><Button onClick={capture}><Plus size={14} />快速记录</Button><small>也可以按 Ctrl+Shift+I 随时记录</small></div>
      : !visible.length ? <div className="inbox-empty"><Inbox size={30} /><h2>{hasFilters ? '没有匹配的灵感' : tab === 'processed' ? '还没有已整理的灵感' : '未整理的灵感已清空'}</h2><p>{hasFilters ? '试试其他关键词，或清除筛选查看当前分类。' : tab === 'processed' ? '将灵感整理为资料，或标记已整理后，会显示在这里。' : '想法已妥善整理，随时可以记录新的灵感。'}</p>{hasFilters ? <Button variant="outline" onClick={clearFilters}>清除筛选</Button> : <Button variant="outline" onClick={tab === 'processed' ? () => setTab('pending') : capture}>{tab === 'processed' ? '查看未整理' : '记录新灵感'}</Button>}</div>
      : <div className={'inbox-layout' + (detailOpen && selected ? ' detail-open' : '')}>
        <div className="inbox-list" aria-label="灵感列表">{visible.map((item) => <button key={item.id} aria-pressed={selected?.id === item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setDetailOpen(true) }}>
          <span className="inbox-item-heading">{item.processed ? <CheckCircle2 size={14} /> : <Lightbulb size={14} />}<strong>{item.title}</strong></span>
          <span className="inbox-item-summary">{item.content || '暂无正文'}</span>
          <span className="inbox-item-meta"><span>{item.tags.slice(0, 2).map((item) => '#' + item).join(' ') || '无标签'}{item.tags.length > 2 ? ` +${item.tags.length - 2}` : ''}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</time></span>
        </button>)}</div>
        <Panel className="inbox-detail">{selected ? <>
          <div className="inbox-detail-header"><Button variant="ghost" className="inbox-back" onClick={() => setDetailOpen(false)}><ArrowLeft size={14} />返回列表</Button><div className="inbox-detail-title"><div><h2>{selected.title}</h2><p>创建于 {new Date(selected.createdAt).toLocaleString('zh-CN')} · 更新于 {new Date(selected.updatedAt).toLocaleString('zh-CN')}</p></div><Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`将灵感“${selected.title}”移入回收站？`)) void deleteEntity(selected.id).catch(setError) }} aria-label="删除灵感"><Trash2 size={14} /></Button></div></div>
          <div className="inbox-detail-scroll"><div className="inbox-reading"><p className="inbox-content">{selected.content}</p><div className="inbox-detail-tags"><h3>标签</h3><div className="inbox-tags">{selected.tags.length ? selected.tags.map((item) => <span key={item}>#{item}</span>) : <small>暂无标签</small>}</div></div></div></div>
          <div className="inbox-detail-footer">{selected.processed ? <div className="inbox-processed"><CheckCircle2 size={15} />{selectedConversionLabel ? `已整理为${selectedConversionLabel}` : '已整理'}</div> : <>
            <div className="inbox-organize"><select className="select-input" aria-label="整理目标" value={conversionKind} disabled={busy} onChange={(event) => setConversionKind(event.target.value as typeof conversionKind)}>{INBOX_CONVERSIONS.map((conversion) => <option key={conversion.kind} value={conversion.kind}>{conversion.label}</option>)}<option value="story-arc-milestone">转为剧情线节点</option></select>
              {conversionKind === 'story-arc-milestone' ? <select className="select-input" aria-label="选择剧情线" value={arcId} disabled={busy} onChange={(event) => setArcId(event.target.value)}><option value="">{arcs.length ? '选择剧情线' : '请先创建剧情线'}</option>{arcs.map((arc) => <option key={arc.id} value={arc.id}>{arc.title}</option>)}</select> : null}
              <Button variant="outline" disabled={busy || (conversionKind === 'story-arc-milestone' && !arcs.some((arc) => arc.id === arcId))} onClick={() => void (conversionKind === 'story-arc-milestone' ? convertToMilestone(selected) : convert(selected, conversionKind))}>{busy ? '整理中…' : '整理为资料'}</Button>
            </div><Button disabled={busy} onClick={() => void markOnly(selected)}><CheckCircle2 size={14} />标记已整理</Button>
          </>}</div>
        </> : <div className="inbox-empty"><Lightbulb size={24} /><p>选择一条灵感查看或整理。</p></div>}</Panel>
      </div>}
  </div>
}