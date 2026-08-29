import { useEffect, useMemo, useState } from 'react'
import { BookOpen, CalendarDays, Clock3, MapPin, Plus, Save, Search, Trash2, Users } from 'lucide-react'
import type { EntityRecord, NodeRecord } from '../lib/types'
import { chapterReferenceTokens, contentText, filterTimelineEntities, findChapterByReference, sortChapterNodes, sortTimelineEntities } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'
import '../planning.css'

interface TimelineDraft {
  title: string
  date: string
  time: string
  description: string
  characters: string
  location: string
  chapters: string
  tags: string
}

function blankDraft(): TimelineDraft {
  return { title: '', date: '', time: '', description: '', characters: '', location: '', chapters: '', tags: '' }
}

function toDraft(entity: EntityRecord | undefined) {
  const draft = blankDraft()
  if (!entity) return draft
  draft.title = entity.title
  draft.date = contentText(entity, 'date')
  draft.time = contentText(entity, 'time')
  draft.description = contentText(entity, 'description')
  draft.characters = contentText(entity, 'characters')
  draft.location = contentText(entity, 'location')
  draft.chapters = contentText(entity, 'chapters')
  draft.tags = entity.tags.filter((tag) => tag !== '时间线').join(', ')
  return draft
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

export function TimelineView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const selectNode = useAppStore((state) => state.selectNode)
  const setError = useAppStore((state) => state.setError)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [characterFilter, setCharacterFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [chapterFilter, setChapterFilter] = useState('')
  const [draft, setDraft] = useState<TimelineDraft>(blankDraft)
  const [busy, setBusy] = useState(false)

  const chapters = useMemo(() => sortChapterNodes(data?.nodes ?? []), [data?.nodes])
  const events = useMemo(() => sortTimelineEntities((data?.entities ?? []).filter((entity) => entity.kind === 'timeline')), [data?.entities])
  const characters = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'character').sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')), [data?.entities])
  const locations = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'location').sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')), [data?.entities])
  const visibleEvents = useMemo(() => filterTimelineEntities(events, { query: filter, character: characterFilter, location: locationFilter, chapter: chapterFilter }), [chapterFilter, characterFilter, events, filter, locationFilter])
  const hasFilter = Boolean(filter.trim() || characterFilter || locationFilter || chapterFilter)
  const selected = events.find((event) => event.id === selectedId)

  useEffect(() => {
    if (!creating && selectedId && !selected) setSelectedId(events[0]?.id ?? null)
    if (!creating && !selectedId && events.length) setSelectedId(events[0].id)
  }, [creating, events, selected, selectedId])

  useEffect(() => {
    setDraft(creating ? blankDraft() : toDraft(selected))
  }, [creating, selected])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: keyof TimelineDraft, value: string) {
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
        kind: 'timeline',
        id: creating ? null : selected?.id ?? null,
        title: draft.title.trim(),
        content: {
          date: draft.date.trim(),
          time: draft.time.trim(),
          description: draft.description,
          characters: draft.characters,
          location: draft.location,
          chapters: draft.chapters,
          tags: draft.tags,
        },
        tags: ['时间线', ...draft.tags.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean)],
      })
      const refreshed = useAppStore.getState().data?.entities ?? []
      const saved = creating
        ? refreshed.filter((entity) => entity.kind === 'timeline' && entity.title === draft.title.trim()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
        : selected
      setCreating(false)
      setSelectedId(saved?.id ?? null)
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

  return <div className="planning-special-view workspace-view">
    <div className="view-header">
      <div><p className="eyebrow">STORY TIMELINE</p><h1>时间线</h1><p>按故事内时间整理关键事件，并把事件和正文章节、人物与地点连接起来。</p></div>
      <div className="special-summary"><strong>{events.length}</strong><span>个事件</span></div>
    </div>
    <div className="special-toolbar timeline-toolbar">
      <div className="special-search"><Search size={14} /><TextInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索事件、人物或地点" /></div>
      <div className="timeline-filters"><select className="select-input" value={characterFilter} onChange={(event) => setCharacterFilter(event.target.value)} aria-label="按人物筛选"><option value="">全部人物</option>{characters.map((character) => <option key={character.id} value={character.title}>{character.title}</option>)}</select><select className="select-input" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="按地点筛选"><option value="">全部地点</option>{locations.map((location) => <option key={location.id} value={location.title}>{location.title}</option>)}</select><select className="select-input" value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)} aria-label="按章节筛选"><option value="">全部章节</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.title}>{chapter.title}</option>)}</select></div>
      <Button onClick={startNew}><Plus size={14} />新建事件</Button>
    </div>
    <div className="special-layout">
      <aside className="special-list-pane">
        <div className="special-list-head"><div className="panel-title"><h3>事件列表</h3><span>{visibleEvents.length} / {events.length}</span></div><p>已按日期、时间排序；没有日期的事件排在最后。</p></div>
        <div className="special-list">{visibleEvents.length ? visibleEvents.map((event) => <button key={event.id} type="button" className={'special-list-item' + (event.id === selectedId && !creating ? ' active' : '')} onClick={() => { setCreating(false); setSelectedId(event.id) }}>
          <span className="special-list-icon"><CalendarDays size={14} /></span>
          <span className="special-list-copy"><strong>{event.title}</strong><small>{[contentText(event, 'date'), contentText(event, 'time'), contentText(event, 'location')].filter(Boolean).join(' · ') || '未填写时间信息'}</small><em>{contentText(event, 'description') || '尚未填写事件描述'}</em></span>
        </button>) : <div className="empty-state"><CalendarDays size={24} /><div><strong>{hasFilter ? '没有匹配事件' : '还没有时间线事件'}</strong><span>{hasFilter ? '换一个筛选条件试试。' : '把故事中的关键节点记录下来，后续可以从章节直接回看。'}</span></div></div>}</div>
      </aside>
      <section className="special-editor">
        <Panel className="special-card">{creating || selected ? <><div className="planning-card-head"><div><p className="eyebrow">EVENT DETAIL</p><h3>{creating ? '新建时间线事件' : selected?.title}</h3></div><span className="planning-state">{busy ? '保存中…' : '本地资料'}</span></div>
          <div className="planning-form">
            <Field label="事件标题"><TextInput autoFocus={creating} value={draft.title} onChange={(event) => updateField('title', event.target.value)} placeholder="例如：雾港第一次停电" /></Field>
            <div className="field-grid"><Field label="故事日期" hint="可填写具体日期、时代或“第 3 日”"><TextInput value={draft.date} onChange={(event) => updateField('date', event.target.value)} placeholder="例如：2026-08-29 / 第三日" /></Field><Field label="时间"><TextInput value={draft.time} onChange={(event) => updateField('time', event.target.value)} placeholder="例如：深夜、黎明" /></Field></div>
            <div className="field-grid"><Field label="地点"><TextInput value={draft.location} onChange={(event) => updateField('location', event.target.value)} placeholder="发生地点" /></Field><Field label="参与人物"><TextInput value={draft.characters} onChange={(event) => updateField('characters', event.target.value)} placeholder="用逗号分隔人物" /></Field></div>
            <Field label="事件描述"><textarea className="text-area" value={draft.description} onChange={(event) => updateField('description', event.target.value)} placeholder="记录发生了什么，以及它对故事造成的影响…" /></Field>
            <Field label="关联章节" hint="可填写章节标题或章节号，多个值用逗号分隔"><TextInput value={draft.chapters} onChange={(event) => updateField('chapters', event.target.value)} placeholder="例如：第一章, 第三章" /></Field>
            <Field label="标签" hint="多个标签用逗号分隔"><TextInput value={draft.tags} onChange={(event) => updateField('tags', event.target.value)} placeholder="例如：转折、线索、高潮" /></Field>
            <div className="special-preview-row"><span><Clock3 size={13} />{draft.date || '未定日期'}{draft.time ? ' · ' + draft.time : ''}</span><span><MapPin size={13} />{draft.location || '未定地点'}</span><span><Users size={13} />{draft.characters || '未指定人物'}</span></div>
            {!creating && selected ? <div className="special-related"><span className="field-label">正文链接</span><ChapterReferences value={draft.chapters} nodes={data.nodes} onOpen={(id) => void selectNode(id)} /></div> : null}
            <div className="entity-actions"><Button onClick={() => void save()} disabled={busy || !draft.title.trim()}><Save size={14} />{busy ? '保存中…' : '保存事件'}</Button>{selected && !creating ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div>
          </div>
        </> : <div className="empty-state"><CalendarDays size={25} /><div><strong>选择一个事件</strong><span>从左侧选择事件，或新建一条时间线记录。</span></div></div>}</Panel>
      </section>
    </div>
  </div>
}
