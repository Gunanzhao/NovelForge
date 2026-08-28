import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ExternalLink, Save, Trash2 } from 'lucide-react'
import type { EntityRecord, NodeRecord } from '../lib/types'
import { contentText } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'

interface OutlineDraft {
  title: string
  goal: string
  conflict: string
  events: string
  result: string
  notes: string
}

function blankDraft(chapter?: NodeRecord): OutlineDraft {
  return { title: chapter ? chapter.title + '大纲' : '', goal: '', conflict: '', events: '', result: '', notes: '' }
}

function chapterOutline(outlines: EntityRecord[], chapterId: string) {
  return outlines.find((outline) => contentText(outline, 'chapterId') === chapterId)
}

export function OutlineView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const selectNode = useAppStore((state) => state.selectNode)
  const setError = useAppStore((state) => state.setError)
  const [chapterId, setChapterId] = useState('')
  const [draft, setDraft] = useState<OutlineDraft>(() => blankDraft())
  const [busy, setBusy] = useState(false)

  const chapters = useMemo(() => (data?.nodes ?? [])
    .filter((node) => node.kind === 'chapter')
    .sort((left, right) => left.orderIndex - right.orderIndex || left.createdAt.localeCompare(right.createdAt)), [data?.nodes])
  const outlines = useMemo(() => data?.entities.filter((entity) => entity.kind === 'outline') ?? [], [data?.entities])
  const chapter = chapters.find((node) => node.id === chapterId)
  const outline = chapterOutline(outlines, chapterId)

  useEffect(() => {
    if (!chapters.some((item) => item.id === chapterId)) setChapterId(chapters[0]?.id ?? '')
  }, [chapters, chapterId])

  useEffect(() => {
    const next = blankDraft(chapter)
    if (outline) {
      next.title = outline.title
      next.goal = contentText(outline, 'goal')
      next.conflict = contentText(outline, 'conflict')
      next.events = contentText(outline, 'events')
      next.result = contentText(outline, 'result')
      next.notes = contentText(outline, 'notes')
    }
    setDraft(next)
  }, [chapter, outline])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: keyof OutlineDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!chapter || !draft.title.trim()) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath, kind: 'outline', id: outline?.id ?? null, title: draft.title.trim(),
        content: {
          chapterId: chapter.id, goal: draft.goal, conflict: draft.conflict, events: draft.events,
          result: draft.result, notes: draft.notes,
        }, tags: ['章节大纲'],
      })
    } catch (error) { setError(error) } finally { setBusy(false) }
  }

  async function remove() {
    if (!outline || !window.confirm('将“' + outline.title + '”移入回收站？')) return
    try { await deleteEntity(outline.id) } catch (error) { setError(error) }
  }

  return <div className="planning-section">
    <div className="planning-section-head"><div><p className="eyebrow">OUTLINE WORKSPACE</p><h2>章节大纲</h2><p>把章节目标、冲突和结果固定下来，再进入正文写作。</p></div><div className="view-actions">{chapter ? <Button variant="outline" onClick={() => void selectNode(chapter.id)}><ExternalLink size={14} />打开正文</Button> : null}</div></div>
    <div className="planning-layout">
      <aside className="planning-list-pane"><div className="planning-list-head"><div className="panel-title"><h3>章节</h3><span>{chapters.length} 章</span></div><p>点击章节切换大纲。</p></div><div className="planning-list">{chapters.length ? chapters.map((item) => { const saved = chapterOutline(outlines, item.id); return <button key={item.id} className={'planning-list-item' + (item.id === chapterId ? ' active' : '')} onClick={() => setChapterId(item.id)}><span className="planning-list-icon"><BookOpen size={14} /></span><span><strong>{item.title}</strong><small>{saved ? '已建立大纲' : '尚未建立大纲'}</small></span><span className={'planning-dot' + (saved ? ' ready' : '')} /></button> }) : <div className="tree-muted">请先在正文结构中创建章节。</div>}</div></aside>
      <section className="planning-editor"><Panel className="planning-card">{chapter ? <><div className="planning-card-head"><div><p className="eyebrow">CHAPTER PLAN</p><h3>{chapter.title}</h3></div><span className={outline ? 'planning-state ready' : 'planning-state'}>{outline ? '已保存' : '未建立'}</span></div><div className="planning-form"><Field label="大纲标题"><TextInput value={draft.title} onChange={(event) => updateField('title', event.target.value)} /></Field><Field label="章节目标" hint="这一章结束时，读者和角色应该获得什么变化？"><textarea className="text-area" value={draft.goal} onChange={(event) => updateField('goal', event.target.value)} placeholder="记录本章要完成的目标…" /></Field><Field label="主要冲突"><textarea className="text-area" value={draft.conflict} onChange={(event) => updateField('conflict', event.target.value)} placeholder="谁与谁、什么力量发生冲突？" /></Field><Field label="重要事件"><textarea className="text-area" value={draft.events} onChange={(event) => updateField('events', event.target.value)} placeholder="按顺序记录关键事件、转折或信息揭示…" /></Field><Field label="结果"><textarea className="text-area" value={draft.result} onChange={(event) => updateField('result', event.target.value)} placeholder="本章留下什么结果或新的悬念？" /></Field><Field label="备注"><textarea className="text-area compact" value={draft.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="补充写作提醒…" /></Field><div className="entity-actions"><Button onClick={() => void save()} disabled={busy || !draft.title.trim()}><Save size={15} />{busy ? '保存中…' : '保存大纲'}</Button>{outline ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div></div></> : <div className="empty-state"><BookOpen size={25} /><div><strong>还没有章节</strong><span>从左侧正文结构创建章节后，就可以建立大纲。</span></div></div>}</Panel></section>
    </div>
  </div>
}
