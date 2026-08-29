import { useMemo, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { sortChapterNodes } from '../lib/planning-data'
import { NODE_STATUS_LABELS } from '../lib/types'
import { useAppStore } from '../stores/app-store'

const columns = Object.entries(NODE_STATUS_LABELS)

export function KanbanView() {
  const data = useAppStore((state) => state.data)
  const selectNode = useAppStore((state) => state.selectNode)
  const setNodeStatus = useAppStore((state) => state.setNodeStatus)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const chapters = useMemo(() => sortChapterNodes(data?.nodes ?? []), [data?.nodes])
  const volumeTitles = useMemo(() => new Map((data?.nodes ?? []).filter((node) => node.kind === 'volume').map((node) => [node.id, node.title])), [data?.nodes])

  if (!data) return null

  async function updateStatus(nodeId: string, status: string) {
    const current = chapters.find((chapter) => chapter.id === nodeId)
    if (!current || current.status === status) return
    setBusyId(nodeId)
    await setNodeStatus(nodeId, status)
    setBusyId(null)
  }

  return <div className="kanban-view workspace-view"><div className="view-header"><div><p className="eyebrow">WRITING FLOW / KANBAN</p><h1>写作看板</h1><p>拖动章节改变写作状态；点击卡片可以直接进入正文。</p></div><div className="kanban-summary"><strong>{chapters.filter((chapter) => chapter.status === 'done').length}</strong><span>/ {chapters.length} 章完成</span></div></div><div className="kanban-board">{columns.map(([status, label]) => { const items = chapters.filter((chapter) => chapter.status === status); return <section className="kanban-column" key={status} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedId) void updateStatus(draggedId, status); setDraggedId(null) }}><div className="kanban-column-head"><h3>{label}</h3><span>{items.length}</span></div><div className="kanban-column-body">{items.length ? items.map((chapter) => <div className={'kanban-card' + (busyId === chapter.id ? ' busy' : '')} key={chapter.id} draggable={busyId === null} onDragStart={() => setDraggedId(chapter.id)} onDragEnd={() => setDraggedId(null)}><button className="kanban-card-main" onClick={() => void selectNode(chapter.id)}><GripVertical size={14} className="kanban-grip" /><span><strong>{chapter.title}</strong><small>{volumeTitles.get(chapter.parentId ?? '') ?? '未分卷'} · {new Date(chapter.updatedAt).toLocaleDateString()}</small></span></button><select className="kanban-status" value={chapter.status} disabled={busyId === chapter.id} aria-label={chapter.title + '状态'} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateStatus(chapter.id, event.target.value)}>{columns.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div>) : <div className="kanban-empty">把章节拖到这里</div>}</div></section> })}</div></div>
}
