import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { sortChapterNodes } from '../lib/planning-data'
import { CHAPTER_STAGES, chapterStage, type ChapterStage } from '../lib/chapter-workflow'
import { isNodeLocked } from '../lib/node-lock'
import { ChapterStageSelect } from './ChapterStageSelect'
import { useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { useContextMenu } from './ContextMenu'

const columns = CHAPTER_STAGES.map(({ id, label }) => [id, label] as const)

export function KanbanView() {
  const data = useAppStore((state) => state.data)
  const selectNode = useAppStore((state) => state.selectNode)
  const setChapterStage = useAppStore((state) => state.setChapterStage)
  const projectPath = useAppStore((state) => state.projectPath)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const chapters = useMemo(() => sortChapterNodes(data?.nodes ?? []), [data?.nodes])
  const volumeTitles = useMemo(() => new Map((data?.nodes ?? []).filter((node) => node.kind === 'volume').map((node) => [node.id, node.title])), [data?.nodes])

  if (!data) return null

  async function updateStatus(nodeId: string, status: ChapterStage) {
    const current = chapters.find((chapter) => chapter.id === nodeId)
    if (!current || chapterStage(current, data!.entities) === status) return
    setBusyId(nodeId)
    try { await setChapterStage(nodeId, status) } catch { /* Store displays the error. */ } finally { setBusyId(null) }
  }

  function openChapterMenu(event: ReactMouseEvent<HTMLDivElement>, chapter: typeof chapters[number]) {
    const statusItems: ContextMenuItem[] = columns.map(([status, label]) => ({ type: 'item' as const, id: 'kanban-status-' + status, label, checked: chapterStage(chapter, data!.entities) === status, onSelect: () => void updateStatus(chapter.id, status) }))
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'kanban-open', label: '打开章节', icon: GripVertical, onSelect: () => void selectNode(chapter.id) },
      { type: 'item', id: 'kanban-status', label: '写作状态', children: statusItems, onSelect: () => undefined },
      { type: 'item', id: 'kanban-copy-title', label: '复制章节标题', onSelect: async () => { if (!await writeClipboardText(chapter.title)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'item', id: 'kanban-copy-path', label: '复制文件路径', onSelect: async () => { if (!await writeClipboardText(chapter.filePath)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
    ]
    openContextMenu(event, { title: chapter.title, location: 'tree.chapter', payload: { location: 'tree.chapter', projectPath: projectPath ?? undefined, nodeIds: [chapter.id], nodeKind: 'chapter' }, items, trigger: event.currentTarget })
  }

  return <div className="kanban-view workspace-view"><div className="view-header"><div><p className="eyebrow">WRITING FLOW / KANBAN</p><h1>写作看板</h1><p>拖动章节改变写作阶段，与正文、章节完成和导出同步；锁定仅保护正文。</p></div><div className="kanban-summary"><strong>{chapters.filter((chapter) => chapterStage(chapter, data.entities) === 'final').length}</strong><span>/ {chapters.length} 章定稿</span></div></div><div className="kanban-board">{columns.map(([status, label]) => { const items = chapters.filter((chapter) => chapterStage(chapter, data!.entities) === status); return <section className="kanban-column" key={status} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedId) void updateStatus(draggedId, status); setDraggedId(null) }}><div className="kanban-column-head"><h3>{label}</h3><span>{items.length}</span></div><div className="kanban-column-body">{items.length ? items.map((chapter) => <div className={'kanban-card' + (busyId === chapter.id ? ' busy' : '')} key={chapter.id} draggable={busyId === null} onDragStart={() => setDraggedId(chapter.id)} onDragEnd={() => setDraggedId(null)} onContextMenu={(event) => openChapterMenu(event, chapter)}><button className="kanban-card-main" onClick={() => void selectNode(chapter.id)}><GripVertical size={14} className="kanban-grip" /><span><strong>{chapter.title}</strong><small>{volumeTitles.get(chapter.parentId ?? '') ?? '未分卷'}{isNodeLocked(data.nodes, chapter.id) ? ' · 已锁定' : ''} · {new Date(chapter.updatedAt).toLocaleDateString()}</small></span></button><ChapterStageSelect chapter={chapter} entities={data.entities} className="kanban-status" label={chapter.title + '写作阶段'} /></div>) : <div className="kanban-empty">把章节拖到这里</div>}</div></section> })}</div></div>
}
