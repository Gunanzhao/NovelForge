import { useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, CheckCircle2, Inbox, Lightbulb, Plus, Search, Trash2 } from 'lucide-react'
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

  useEffect(() => {
    const show = () => { if (useAppStore.getState().projectPath) setOpen(true) }
    window.addEventListener('novelforge:quick-inbox', show)
    return () => window.removeEventListener('novelforge:quick-inbox', show)
  }, [])

  if (!projectPath) return null
  const currentProjectPath = projectPath
  async function save() {
    if (!content.trim()) return
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
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }
  return <Modal open={open} title="快速记录灵感" onClose={() => setOpen(false)} footer={<><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={busy || !content.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存灵感'}</Button></>}><div className="inbox-capture-form"><Field label="标题（可选）"><TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="留空时使用正文第一行" /></Field><Field label="正文"><textarea autoFocus className="text-area" value={content} onChange={(event) => setContent(event.target.value)} placeholder="先记下来，稍后整理…" /></Field><Field label="标签"><TextInput value={tags} onChange={(event) => setTags(event.target.value)} placeholder="使用逗号分隔" /></Field></div></Modal>
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

  return <div className="workspace-view inbox-view">
    <div className="view-header"><div><p className="eyebrow">IDEA INBOX</p><h1>灵感箱</h1><p>先捕获，再决定它属于人物、地点、场景、伏笔或剧情线。</p></div><div className="view-actions"><Button variant="outline" onClick={() => setView('trash')}><ArchiveRestore size={14} />前往回收站恢复</Button><Button onClick={() => window.dispatchEvent(new Event('novelforge:quick-inbox'))}><Plus size={14} />快速记录</Button></div></div>
    <div className="inbox-toolbar"><div className="planning-tabs"><button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>未整理 ({items.filter((item) => !item.processed).length})</button><button className={tab === 'processed' ? 'active' : ''} onClick={() => setTab('processed')}>已整理 ({items.filter((item) => item.processed).length})</button></div><div className="inbox-filters"><label><Search size={13} /><TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索灵感" /></label><select className="select-input" value={tag} onChange={(event) => setTag(event.target.value)} aria-label="灵感标签过滤"><option value="">全部标签</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}</select><select className="select-input" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="灵感时间排序"><option value="newest">最新优先</option><option value="oldest">最早优先</option></select></div></div>
    <div className="inbox-layout"><div className="inbox-list">{visible.length ? visible.map((item) => <button key={item.id} className={(selected?.id === item.id ? 'active' : '')} onClick={() => setSelectedId(item.id)}><span>{item.processed ? <CheckCircle2 size={13} /> : <Lightbulb size={13} />}</span><span><strong>{item.title}</strong><small>{item.tags.join(' · ') || '无标签'} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small></span></button>) : <div className="empty-state"><Inbox size={24} /><span>这里还没有符合条件的灵感。</span></div>}</div><Panel className="inbox-detail">{selected ? <><div className="panel-title"><h3>{selected.title}</h3><Button variant="danger" disabled={busy} onClick={() => { if (window.confirm(`将灵感“${selected.title}”移入回收站？`)) void deleteEntity(selected.id) }}><Trash2 size={12} />删除</Button></div><div className="inbox-tags">{selected.tags.map((item) => <span key={item}>{item}</span>)}</div><pre>{selected.content}</pre>{selected.processed ? <div className="inbox-processed"><CheckCircle2 size={15} />已整理为 {selected.processedInto?.kind ?? '资料'} · {selected.processedInto?.id ?? ''}</div> : <><div className="inbox-conversions">{INBOX_CONVERSIONS.map((conversion) => <Button variant="outline" disabled={busy} key={conversion.kind} onClick={() => void convert(selected, conversion.kind)}>{conversion.label}</Button>)}</div><div className="inbox-arc-conversion"><select className="select-input" value={arcId} onChange={(event) => setArcId(event.target.value)}><option value="">选择剧情线</option>{arcs.map((arc) => <option key={arc.id} value={arc.id}>{arc.title}</option>)}</select><Button variant="outline" disabled={busy || !arcId} onClick={() => void convertToMilestone(selected)}>转为剧情线 milestone</Button></div></>}</> : <div className="empty-state"><Lightbulb size={24} /><span>选择一条灵感查看详情。</span></div>}</Panel></div>
  </div>
}
