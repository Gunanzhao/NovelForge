import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { BookOpen, Copy, ExternalLink, Save, Trash2 } from 'lucide-react'
import type { EntityRecord, NodeRecord } from '../lib/types'
import { contentText, sortChapterNodes } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { Button, Field, Panel, TextInput } from './ui'
import { useContextMenu } from './ContextMenu'

type OutlineTargetKind = 'work' | 'volume' | 'chapter'

interface OutlineTarget {
  key: string
  kind: OutlineTargetKind
  id: string
  title: string
  node?: NodeRecord
}

interface OutlineDraft {
  title: string
  goal: string
  conflict: string
  events: string
  result: string
  notes: string
}

function targetKey(kind: OutlineTargetKind, id: string) {
  return kind + ':' + id
}

function targetFromOutline(outline: EntityRecord): { kind: OutlineTargetKind; id: string } | undefined {
  const kind = contentText(outline, 'targetKind')
  const id = contentText(outline, 'targetId')
  if ((kind === 'work' || kind === 'volume' || kind === 'chapter') && id) return { kind, id }
  const legacyChapterId = contentText(outline, 'chapterId')
  return legacyChapterId ? { kind: 'chapter', id: legacyChapterId } : undefined
}

function outlineForTarget(outlines: EntityRecord[], target: OutlineTarget | undefined) {
  if (!target) return undefined
  return outlines.find((outline) => {
    const reference = targetFromOutline(outline)
    return reference?.kind === target.kind && reference.id === target.id
  })
}

function targetKindLabel(kind: OutlineTargetKind) {
  if (kind === 'work') return '作品'
  if (kind === 'volume') return '卷'
  return '章节'
}

function blankDraft(target?: OutlineTarget): OutlineDraft {
  return { title: target ? target.title + '大纲' : '', goal: '', conflict: '', events: '', result: '', notes: '' }
}

export function OutlineView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const selectNode = useAppStore((state) => state.selectNode)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const [selectedTargetKey, setSelectedTargetKey] = useState('')
  const [draft, setDraft] = useState<OutlineDraft>(() => blankDraft())
  const [busy, setBusy] = useState(false)

  const targets = useMemo<OutlineTarget[]>(() => {
    if (!data) return []
    const volumes = data.nodes
      .filter((node) => node.kind === 'volume')
      .sort((left, right) => left.orderIndex - right.orderIndex || left.createdAt.localeCompare(right.createdAt))
    const chapters = sortChapterNodes(data.nodes)
    return [
      { key: targetKey('work', data.project.id), kind: 'work', id: data.project.id, title: data.project.title },
      ...volumes.map((node) => ({ key: targetKey('volume', node.id), kind: 'volume' as const, id: node.id, title: node.title, node })),
      ...chapters.map((node) => ({ key: targetKey('chapter', node.id), kind: 'chapter' as const, id: node.id, title: node.title, node })),
    ]
  }, [data])
  const outlines = useMemo(() => data?.entities.filter((entity) => entity.kind === 'outline') ?? [], [data?.entities])
  const selectedTarget = targets.find((target) => target.key === selectedTargetKey)
  const outline = outlineForTarget(outlines, selectedTarget)

  useEffect(() => {
    if (!targets.some((target) => target.key === selectedTargetKey)) setSelectedTargetKey(targets[0]?.key ?? '')
  }, [selectedTargetKey, targets])

  useEffect(() => {
    const next = blankDraft(selectedTarget)
    if (outline) {
      next.title = outline.title
      next.goal = contentText(outline, 'goal')
      next.conflict = contentText(outline, 'conflict')
      next.events = contentText(outline, 'events')
      next.result = contentText(outline, 'result')
      next.notes = contentText(outline, 'notes')
    }
    setDraft(next)
  }, [outline, selectedTarget])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: keyof OutlineDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!selectedTarget || !draft.title.trim()) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath, kind: 'outline', id: outline?.id ?? null, title: draft.title.trim(),
        content: {
          targetKind: selectedTarget.kind, targetId: selectedTarget.id,
          ...(selectedTarget.kind === 'chapter' ? { chapterId: selectedTarget.id } : {}),
          goal: draft.goal, conflict: draft.conflict, events: draft.events,
          result: draft.result, notes: draft.notes,
        },
        tags: [targetKindLabel(selectedTarget.kind) + '大纲'],
      })
    } catch (error) { setError(error) } finally { setBusy(false) }
  }

  async function remove() {
    if (!outline || !window.confirm('将“' + outline.title + '”移入回收站？')) return
    try { await deleteEntity(outline.id) } catch (error) { setError(error) }
  }

  function openOutlineMenu(event: ReactMouseEvent<HTMLButtonElement>, target: OutlineTarget) {
    const saved = outlineForTarget(outlines, target)
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'outline-open', label: '打开／编辑', icon: BookOpen, onSelect: () => setSelectedTargetKey(target.key) },
      { type: 'item', id: 'outline-copy-title', label: '复制标题', icon: Copy, onSelect: async () => { if (!await writeClipboardText(target.title)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      ...(saved ? [{ type: 'item' as const, id: 'outline-copy-path', label: '复制 Markdown 路径', icon: Copy, onSelect: async () => { if (!await writeClipboardText(saved.filePath)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } }] : []),
      ...(target.node?.kind === 'chapter' ? [{ type: 'item' as const, id: 'outline-open-manuscript', label: '打开正文', icon: ExternalLink, onSelect: () => void selectNode(target.node?.id ?? '') }] : []),
      ...(saved ? [{ type: 'separator' as const }, { type: 'item' as const, id: 'outline-trash', label: '移入回收站', icon: Trash2, tone: 'danger' as const, onSelect: async () => { if (window.confirm('将“' + saved.title + '”移入回收站？')) await deleteEntity(saved.id) } }] : []),
    ]
    openContextMenu(event, { title: target.title, location: 'workspace', payload: { location: 'workspace', projectPath: currentProjectPath, entityId: saved?.id, entityKind: 'outline' }, items, trigger: event.currentTarget })
  }

  return <div className="planning-section">
    <div className="planning-section-head"><div><p className="eyebrow">OUTLINE WORKSPACE</p><h2>作品大纲</h2><p>从作品、卷到章节逐级拆解目标、冲突、事件和结果。</p></div><div className="view-actions">{selectedTarget?.node?.kind === 'chapter' ? <Button variant="outline" onClick={() => void selectNode(selectedTarget.node?.id ?? '')}><ExternalLink size={14} />打开正文</Button> : null}</div></div>
    <div className="planning-layout">
      <aside className="planning-list-pane"><div className="planning-list-head"><div className="panel-title"><h3>大纲层级</h3><span>{targets.length} 项</span></div><p>作品、卷和章节可以分别建立大纲。</p></div><div className="planning-list">{targets.length ? targets.map((target) => { const saved = Boolean(outlineForTarget(outlines, target)); return <button key={target.key} className={'planning-list-item' + (target.key === selectedTargetKey ? ' active' : '')} style={{ paddingLeft: target.kind === 'chapter' ? 26 : 12 }} onClick={() => setSelectedTargetKey(target.key)} onContextMenu={(event) => openOutlineMenu(event, target)}><span className="planning-list-icon"><BookOpen size={14} /></span><span><strong>{target.title}</strong><small>{targetKindLabel(target.kind)} · {saved ? '已建立大纲' : '尚未建立大纲'}</small></span><span className={'planning-dot' + (saved ? ' ready' : '')} /></button> }) : <div className="tree-muted">请先打开一个项目。</div>}</div></aside>
      <section className="planning-editor"><Panel className="planning-card">{selectedTarget ? <><div className="planning-card-head"><div><p className="eyebrow">{targetKindLabel(selectedTarget.kind).toUpperCase()} PLAN</p><h3>{selectedTarget.title}</h3></div><span className={outline ? 'planning-state ready' : 'planning-state'}>{outline ? '已保存' : '未建立'}</span></div><div className="planning-form"><Field label="大纲标题"><TextInput value={draft.title} onChange={(event) => updateField('title', event.target.value)} /></Field><Field label="目标" hint="这一层结束时，故事、读者和角色应该获得什么变化？"><textarea className="text-area" value={draft.goal} onChange={(event) => updateField('goal', event.target.value)} placeholder="记录这一层要完成的目标…" /></Field><Field label="主要冲突"><textarea className="text-area" value={draft.conflict} onChange={(event) => updateField('conflict', event.target.value)} placeholder="谁与谁、什么力量发生冲突？" /></Field><Field label="重要事件"><textarea className="text-area" value={draft.events} onChange={(event) => updateField('events', event.target.value)} placeholder="按顺序记录关键事件、转折或信息揭示…" /></Field><Field label="结果"><textarea className="text-area" value={draft.result} onChange={(event) => updateField('result', event.target.value)} placeholder="这一层留下什么结果或新的悬念？" /></Field><Field label="备注"><textarea className="text-area compact" value={draft.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="补充写作提醒…" /></Field><div className="entity-actions"><Button onClick={() => void save()} disabled={busy || !draft.title.trim()}><Save size={15} />{busy ? '保存中…' : '保存大纲'}</Button>{outline ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={15} />移入回收站</Button> : null}</div></div></> : <div className="empty-state"><BookOpen size={25} /><div><strong>还没有大纲目标</strong><span>从作品、卷或章节中选择一个目标。</span></div></div>}</Panel></section>
    </div>
  </div>
}
