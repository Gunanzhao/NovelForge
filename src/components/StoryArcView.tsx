import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Flag, GripVertical, Plus, Save, Trash2 } from 'lucide-react'
import {
  moveStoryArcMilestone, parseStoryArc, STORY_ARC_STATUSES, storyArcEntityInputContent,
} from '../lib/story-arc-data'
import type { StoryArcContent, StoryArcMilestone } from '../lib/story-arc-data'
import { sortChapterNodes } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, TextInput } from './ui'

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `arc-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function blankArc(): StoryArcContent {
  return { description: '', status: 'planned', color: '#8b5cf6', priority: 0, chapterIds: [], milestones: [] }
}

export function StoryArcView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const selectedEntityId = useAppStore((state) => state.selectedEntityId)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const selectNode = useAppStore((state) => state.selectNode)
  const setError = useAppStore((state) => state.setError)
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState<StoryArcContent>(blankArc)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const arcs = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'story-arc')
    .sort((left, right) => parseStoryArc(right).priority - parseStoryArc(left).priority || left.title.localeCompare(right.title, 'zh-CN')), [data?.entities])
  const selected = arcs.find((arc) => arc.id === selectedEntityId)
  const chapters = useMemo(() => sortChapterNodes(data?.nodes ?? []), [data?.nodes])

  useEffect(() => {
    setTitle(selected?.title ?? '')
    setDraft(selected ? parseStoryArc(selected) : blankArc())
  }, [selected])

  useEffect(() => {
    const create = () => selectEntity('story-arc', null)
    window.addEventListener('novelforge:new-story-arc', create)
    return () => window.removeEventListener('novelforge:new-story-arc', create)
  }, [selectEntity])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateMilestone(id: string, patch: Partial<StoryArcMilestone>) {
    setDraft((current) => ({ ...current, milestones: current.milestones.map((item) => item.id === id ? { ...item, ...patch } : item) }))
  }

  function addMilestone() {
    setDraft((current) => ({
      ...current,
      milestones: [...current.milestones, { id: newId(), title: '新剧情节点', order: current.milestones.length, status: 'planned' }],
    }))
  }

  async function save() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'story-arc',
        id: selected?.id ?? null,
        title: title.trim(),
        content: storyArcEntityInputContent(draft),
        tags: ['剧情线', draft.status],
      })
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`将剧情线“${selected.title}”移入回收站？`)) return
    await deleteEntity(selected.id)
  }

  return <div className="story-arc-view">
    <aside className="story-arc-list">
      <div className="panel-title"><h2>剧情线</h2><Button onClick={() => selectEntity('story-arc', null)}><Plus size={14} />新建</Button></div>
      <p className="field-hint">集中跟踪主线、感情线和伏笔线的推进节奏。</p>
      <div className="story-arc-list-items">{arcs.length ? arcs.map((arc) => {
        const content = parseStoryArc(arc)
        return <button key={arc.id} className={'story-arc-list-item' + (selected?.id === arc.id ? ' active' : '')} onClick={() => selectEntity('story-arc', arc.id)}><span className="story-arc-color" style={{ background: content.color }} /><span><strong>{arc.title}</strong><small>{STORY_ARC_STATUSES.find((item) => item.id === content.status)?.label} · {content.milestones.filter((item) => item.status === 'completed').length}/{content.milestones.length} 节点</small></span></button>
      }) : <div className="tree-muted">还没有剧情线。</div>}</div>
    </aside>
    <section className="story-arc-editor">
      <div className="view-header"><div><p className="eyebrow">STORY ARC</p><h1>{selected ? selected.title : '新建剧情线'}</h1><p>章节关联和节点只提供提示，不会自动修改正文。</p></div></div>
      <div className="story-arc-form">
        <div className="field-grid"><Field label="名称"><TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：寻找星核" /></Field><Field label="状态"><select className="select-input" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as StoryArcContent['status'] }))}>{STORY_ARC_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>
        <div className="field-grid"><Field label="颜色"><input className="story-arc-color-input" type="color" value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} /></Field><Field label="优先级"><TextInput type="number" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value) || 0 }))} /></Field></div>
        <Field label="说明"><textarea className="text-area" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="这条剧情线解决什么冲突？" /></Field>
        <div className="story-arc-section"><div className="panel-title"><h3>关联章节</h3><span>{draft.chapterIds.length} 章</span></div><div className="story-arc-chapters">{chapters.map((chapter) => <label key={chapter.id}><input type="checkbox" checked={draft.chapterIds.includes(chapter.id)} onChange={() => setDraft((current) => ({ ...current, chapterIds: current.chapterIds.includes(chapter.id) ? current.chapterIds.filter((id) => id !== chapter.id) : [...current.chapterIds, chapter.id] }))} /><span>{chapter.title}</span><button type="button" onClick={() => void selectNode(chapter.id)}>跳转</button></label>)}</div></div>
        <div className="story-arc-section"><div className="panel-title"><h3>剧情节点</h3><Button variant="ghost" onClick={addMilestone}><Plus size={13} />添加节点</Button></div><div className="story-arc-milestones">{draft.milestones.length ? draft.milestones.map((milestone, index) => <div className="story-arc-milestone" key={milestone.id} draggable onDragStart={() => setDragging(milestone.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging) setDraft((current) => ({ ...current, milestones: moveStoryArcMilestone(current.milestones, dragging, milestone.id) })); setDragging(null) }}><GripVertical size={14} /><div className="story-arc-milestone-fields"><TextInput value={milestone.title} onChange={(event) => updateMilestone(milestone.id, { title: event.target.value })} aria-label="剧情节点标题" /><select className="select-input" value={milestone.chapterId ?? ''} onChange={(event) => updateMilestone(milestone.id, { chapterId: event.target.value || undefined })} aria-label="剧情节点章节"><option value="">暂未关联章节</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select><select className="select-input" value={milestone.status} onChange={(event) => updateMilestone(milestone.id, { status: event.target.value as StoryArcMilestone['status'] })} aria-label="剧情节点状态"><option value="planned">计划中</option><option value="completed">已完成</option></select><TextInput value={milestone.note ?? ''} onChange={(event) => updateMilestone(milestone.id, { note: event.target.value })} placeholder="备注" /></div><div className="story-arc-milestone-actions"><Button variant="ghost" disabled={index === 0} onClick={() => setDraft((current) => ({ ...current, milestones: moveStoryArcMilestone(current.milestones, milestone.id, current.milestones[index - 1].id) }))}><ArrowUp size={12} /></Button><Button variant="ghost" disabled={index === draft.milestones.length - 1} onClick={() => setDraft((current) => ({ ...current, milestones: moveStoryArcMilestone(current.milestones, milestone.id, current.milestones[index + 1].id) }))}><ArrowDown size={12} /></Button><Button variant="ghost" onClick={() => setDraft((current) => ({ ...current, milestones: current.milestones.filter((item) => item.id !== milestone.id).map((item, order) => ({ ...item, order })) }))}><Trash2 size={12} /></Button></div></div>) : <div className="empty-state"><Flag size={20} /><span>添加第一个剧情节点。</span></div>}</div></div>
        <div className="entity-actions"><Button disabled={busy || !title.trim()} onClick={() => void save()}><Save size={14} />{busy ? '保存中…' : '保存剧情线'}</Button>{selected ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div>
      </div>
    </section>
  </div>
}
