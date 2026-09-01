import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDown, ArrowRightLeft, ArrowUp, BarChart3, BookOpen, ChevronDown, ChevronRight, CircleUserRound, Clock3, Copy, FileDown, FilePlus2, FolderTree,
  GalleryVerticalEnd, GitBranch, Globe2, LayoutDashboard, MoreHorizontal, Network, Paperclip, Plus, Search,
  ShieldCheck, Sparkles, Trash2, WandSparkles, X,
} from 'lucide-react'
import { useAppStore } from '../stores/app-store'
import type { NodeKind, NodeRecord, ViewId } from '../lib/types'
import { NODE_STATUS_LABELS } from '../lib/types'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { useContextMenu } from './ContextMenu'

import { cn } from '../lib/utils'
import { Button, IconButton } from './ui'

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: '总览', icon: LayoutDashboard },
  { id: 'manuscript', label: '正文', icon: BookOpen },
  { id: 'outline', label: '写作规划', icon: BookOpen },
  { id: 'character', label: '人物', icon: CircleUserRound },
  { id: 'location', label: '地点', icon: GalleryVerticalEnd },
  { id: 'world', label: '世界观 Wiki', icon: Globe2 },
  { id: 'timeline', label: '时间线', icon: Clock3 },
  { id: 'foreshadowing', label: '伏笔', icon: GitBranch },
  { id: 'relationship', label: '人物关系图', icon: Network },
  { id: 'attachment', label: '资料附件', icon: Paperclip },
  { id: 'consistency', label: '一致性检查', icon: ShieldCheck },
  { id: 'statistics', label: '详细统计', icon: BarChart3 },
  { id: 'ai', label: 'AI 辅助', icon: Sparkles },
]

function nodeChildren(nodes: NodeRecord[], parentId: string) {
  return nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)
}

function flattenTree(nodes: NodeRecord[], volumes: NodeRecord[], openNodes: Set<string>) {
  const rows: Array<{ node: NodeRecord; level: number }> = []
  const visit = (node: NodeRecord, level: number) => {
    rows.push({ node, level })
    if (openNodes.has(node.id)) nodeChildren(nodes, node.id).forEach((child) => visit(child, level + 1))
  }
  volumes.forEach((volume) => visit(volume, 0))
  return rows
}

function NodeRow({ node, level, open, selected, onToggle, onSelect, onSelectToggle, onAdd, onRename, onMove, onCopy, onDelete, onContextMenu, onDragStart, onDrop }: {
  node: NodeRecord
  level: number
  open: boolean
  selected: boolean
  onToggle: () => void
  onSelect: () => void
  onSelectToggle: () => void
  onAdd: () => void
  onRename: () => void
  onMove: () => void
  onCopy: () => void
  onDelete: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onDragStart: () => void
  onDrop: () => void
}) {
  const isContainer = node.kind !== 'section'
  const hasChildren = isContainer
  return <div className="tree-row-wrap">
    <div className={cn('tree-row', node.kind !== 'volume' && 'tree-document-row', selected && 'selected')} style={{ paddingLeft: 5 + level * 13 }} draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop() }} onDoubleClick={onRename} onContextMenu={onContextMenu}>
      {hasChildren ? <IconButton icon={open ? ChevronDown : ChevronRight} label={open ? '收起' : '展开'} onClick={onToggle} className="tree-toggle" /> : <span style={{ width: 30 }} />}
      <input type="checkbox" className="tree-checkbox" checked={selected} onChange={onSelectToggle} onClick={(event) => event.stopPropagation()} aria-label={'选择' + node.title} />
      <button className="tree-main-button" onClick={onSelect}>
        <span className="tree-icon">{node.kind === 'volume' ? <FolderTree size={15} /> : <BookOpen size={14} />}</span>
        <span className="tree-label">{node.title}</span>
        {node.kind === 'chapter' ? <span className={cn('tree-status-dot', node.status)} /> : null}
      </button>
      <span className="tree-row-actions">
        {node.kind !== 'section' ? <IconButton icon={Plus} label={'在此新建' + (node.kind === 'volume' ? '章' : '节')} onClick={onAdd} /> : null}
        {node.kind !== 'volume' ? <IconButton icon={ArrowRightLeft} label="移动节点" onClick={onMove} /> : null}
        <IconButton icon={Copy} label="复制节点" onClick={onCopy} />
        <IconButton icon={MoreHorizontal} label="更多操作" onClick={onRename} />
        <IconButton icon={X} label="移入回收站" onClick={onDelete} />
      </span>
    </div>
  </div>
}

export function Sidebar({
  onAddNode, onMoveNode, onCopyNode, onExportNode,
}: {
  onAddNode: (kind: NodeKind, parentId: string | null) => void
  onMoveNode: (node: NodeRecord) => void
  onCopyNode: (node: NodeRecord) => void
  onExportNode: (node: NodeRecord) => void
}) {
  const data = useAppStore((state) => state.data)
  const activeView = useAppStore((state) => state.activeView)

  const setView = useAppStore((state) => state.setView)
  const selectNode = useAppStore((state) => state.selectNode)

  const renameNode = useAppStore((state) => state.renameNode)
  const deleteNode = useAppStore((state) => state.deleteNode)
  const setNodeStatus = useAppStore((state) => state.setNodeStatus)
  const reorderNode = useAppStore((state) => state.reorderNode)
  const moveNode = useAppStore((state) => state.moveNode)
  const projectPath = useAppStore((state) => state.projectPath)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set())
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const [treeScrollTop, setTreeScrollTop] = useState(0)
  const [treeViewportHeight, setTreeViewportHeight] = useState(480)

  const volumes = useMemo(() => (data?.nodes ?? []).filter((node) => node.kind === 'volume').sort((a, b) => a.orderIndex - b.orderIndex), [data?.nodes])
  const flatTree = useMemo(() => flattenTree(data?.nodes ?? [], volumes, openNodes), [data?.nodes, openNodes, volumes])
  const treeRowHeight = 38
  const treeOverscan = 10
  const visibleStart = Math.max(0, Math.floor(treeScrollTop / treeRowHeight) - treeOverscan)
  const visibleEnd = Math.min(flatTree.length, Math.ceil((treeScrollTop + treeViewportHeight) / treeRowHeight) + treeOverscan)
  const visibleTree = flatTree.slice(visibleStart, visibleEnd)

  useEffect(() => {
    const element = treeRef.current
    if (!element) return
    const updateHeight = () => setTreeViewportHeight(element.clientHeight || 480)
    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  if (!data) return null
  const currentData = data

  const toggle = (id: string) => setOpenNodes((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const handleRename = (node: NodeRecord) => {
    const title = window.prompt('重命名', node.title)
    if (title?.trim() && title.trim() !== node.title) void renameNode(node.id, title.trim())
  }
  const handleDelete = (node: NodeRecord) => {
    if (window.confirm('将“' + node.title + '”移入回收站？正文文件可在回收站恢复。')) void deleteNode(node.id)
  }
  const toggleSelection = (id: string) => setSelectedNodeIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  async function deleteSelected() {
    const selected = currentData.nodes.filter((node) => selectedNodeIds.has(node.id))
    const roots = selected.filter((node) => !selected.some((candidate) => candidate.id === node.parentId))
    if (!roots.length || !window.confirm('将选中的 ' + String(roots.length) + ' 个节点移入回收站？')) return
    try {
      for (const node of roots) await deleteNode(node.id)
      setSelectedNodeIds(new Set())
    } catch {
      // Store 已经显示具体错误，保留剩余选择方便继续处理。
    }
  }
  function siblingNodes(node: NodeRecord) {
    return currentData.nodes.filter((candidate) => candidate.kind === node.kind && candidate.parentId === node.parentId).sort((a, b) => a.orderIndex - b.orderIndex)
  }
  function openNodeMenu(event: ReactMouseEvent<HTMLDivElement>, node: NodeRecord) {
    const preservingSelection = selectedNodeIds.has(node.id) && selectedNodeIds.size > 1
    const ids = preservingSelection ? [...selectedNodeIds] : [node.id]
    if (!preservingSelection && (!selectedNodeIds.has(node.id) || selectedNodeIds.size !== 1)) setSelectedNodeIds(new Set([node.id]))
    const selectedNodes = currentData.nodes.filter((candidate) => ids.includes(candidate.id))
    if (preservingSelection) {
      const allChapters = selectedNodes.length > 0 && selectedNodes.every((candidate) => candidate.kind === 'chapter')
      const statusItems: ContextMenuItem[] = allChapters ? Object.entries(NODE_STATUS_LABELS).map(([status, label]) => ({
        type: 'item' as const,
        id: 'selection-status-' + status,
        label,
        checked: selectedNodes.every((candidate) => candidate.status === status),
        onSelect: async () => { for (const candidate of selectedNodes) await setNodeStatus(candidate.id, status) },
      })) : []
      const items: ContextMenuItem[] = [
        ...(allChapters ? [{ type: 'item' as const, id: 'selection-status', label: '批量设置状态', children: statusItems, onSelect: () => undefined }] : []),
        { type: 'item', id: 'selection-trash', label: '批量移入回收站', icon: Trash2, tone: 'danger', onSelect: () => void deleteSelected() },
        { type: 'separator' },
        { type: 'item', id: 'selection-clear', label: '清除选择', onSelect: () => setSelectedNodeIds(new Set()) },
      ]
      openContextMenu(event, { title: '已选 ' + String(ids.length) + ' 项', location: 'tree.selection', payload: { location: 'tree.selection', projectPath: projectPath ?? undefined, nodeIds: ids }, items, trigger: event.currentTarget })
      return
    }
    const siblings = siblingNodes(node)
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === node.id)
    const location = ('tree.' + node.kind) as 'tree.volume' | 'tree.chapter' | 'tree.section'
    const copyPath = async () => { if (!await writeClipboardText(node.filePath)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') }
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'node-open', label: node.kind === 'volume' ? (openNodes.has(node.id) ? '收起' : '展开') : '打开' , icon: node.kind === 'volume' ? (openNodes.has(node.id) ? ChevronDown : ChevronRight) : BookOpen, onSelect: () => node.kind === 'volume' ? toggle(node.id) : void selectNode(node.id) },
      ...(node.kind !== 'section' ? [{ type: 'item' as const, id: 'node-add', label: node.kind === 'volume' ? '新建章节' : '新建小节', icon: Plus, onSelect: () => onAddNode(node.kind === 'volume' ? 'chapter' : 'section', node.id) }] : []),
      { type: 'item', id: 'node-rename', label: '重命名', onSelect: () => handleRename(node) },
      { type: 'item', id: 'node-copy', label: node.kind === 'volume' ? '复制整卷' : node.kind === 'chapter' ? '复制章节' : '复制小节', icon: Copy, onSelect: () => onCopyNode(node) },
      ...(node.kind !== 'volume' ? [{ type: 'item' as const, id: 'node-move', label: node.kind === 'chapter' ? '移动到其他卷' : '移动到其他章节', icon: ArrowRightLeft, onSelect: () => onMoveNode(node) }] : []),
      { type: 'item', id: 'node-up', label: '上移', icon: ArrowUp, disabled: siblingIndex <= 0, onSelect: () => void reorderNode(node.id, 'up') },
      { type: 'item', id: 'node-down', label: '下移', icon: ArrowDown, disabled: siblingIndex < 0 || siblingIndex >= siblings.length - 1, onSelect: () => void reorderNode(node.id, 'down') },
      ...(node.kind === 'chapter' ? [{ type: 'item' as const, id: 'node-status', label: '写作状态', children: Object.entries(NODE_STATUS_LABELS).map(([status, label]) => ({ type: 'item' as const, id: 'node-status-' + status, label, checked: node.status === status, onSelect: () => void setNodeStatus(node.id, status) })), onSelect: () => undefined }] : []),
      ...(node.kind !== 'section' ? [{ type: 'item' as const, id: 'node-export', label: node.kind === 'volume' ? '导出此卷' : '导出此章', icon: FileDown, onSelect: () => onExportNode(node) }] : []),
      { type: 'item', id: 'node-copy-title', label: node.kind === 'chapter' ? '复制章节标题' : '复制标题', icon: Copy, onSelect: async () => { if (!await writeClipboardText(node.title)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'item', id: 'node-copy-path', label: node.kind === 'chapter' ? '复制文件路径' : '复制目录路径', icon: Copy, onSelect: copyPath },
      { type: 'separator' },
      { type: 'item', id: 'node-trash', label: '移入回收站', icon: Trash2, tone: 'danger', onSelect: () => handleDelete(node) },
    ]
    openContextMenu(event, { title: node.title, location, payload: { location, projectPath: projectPath ?? undefined, nodeIds: [node.id], nodeKind: node.kind }, items, trigger: event.currentTarget })
  }
  function handleDrop(target: NodeRecord) {
    const source = draggedNodeId ? currentData.nodes.find((node) => node.id === draggedNodeId) : undefined
    setDraggedNodeId(null)
    if (!source || source.id === target.id) return
    if (source.parentId === target.parentId) {
      void reorderNode(source.id, source.orderIndex < target.orderIndex ? 'down' : 'up')
      return
    }
    if ((source.kind === 'chapter' && target.kind === 'volume') || (source.kind === 'section' && target.kind === 'chapter')) {
      void moveNode(source.id, target.id)
    }
  }
  return <aside className="sidebar">
    <div className="sidebar-inner">
      <div className="sidebar-head"><div><h2>项目导航</h2><small>{data.project.title}</small></div><IconButton icon={Plus} label="新建卷" onClick={() => onAddNode('volume', null)} /></div>
      <div className="sidebar-section-label"><span>工作台</span></div>
      <div className="nav-list">
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={cn('nav-item', activeView === id && 'active')} onClick={() => id === 'manuscript' ? setView('manuscript') : setView(id)}><Icon size={15} strokeWidth={1.8} /><span>{label}</span>{id === 'character' ? <span className="count">{data.entities.filter((entity) => entity.kind === 'character').length}</span> : null}</button>)}
        <button className={cn('nav-item', activeView === 'search' && 'active')} onClick={() => setView('search')}><Search size={15} strokeWidth={1.8} /><span>全文搜索</span><span className="count">⌘</span></button>
      </div>
      <div className="sidebar-section-label"><span>正文结构</span><span>{data.nodes.filter((node) => node.kind === 'chapter').length} 章</span></div>
      <div className="tree" ref={treeRef} onScroll={(event) => setTreeScrollTop(event.currentTarget.scrollTop)}>
        {volumes.length === 0 ? <div className="tree-muted">还没有卷，点击右上角创建第一卷。</div> : <div className="tree-virtual-content" style={{ height: flatTree.length * treeRowHeight }}><div className="tree-virtual-rows" style={{ top: visibleStart * treeRowHeight }}>{visibleTree.map(({ node, level }) => <NodeRow key={node.id} node={node} level={level} open={openNodes.has(node.id)} selected={selectedNodeIds.has(node.id)} onToggle={() => toggle(node.id)} onSelect={() => node.kind === 'volume' ? toggle(node.id) : void selectNode(node.id)} onSelectToggle={() => toggleSelection(node.id)} onAdd={() => onAddNode(node.kind === 'volume' ? 'chapter' : 'section', node.id)} onRename={() => handleRename(node)} onMove={() => onMoveNode(node)} onCopy={() => onCopyNode(node)} onDelete={() => handleDelete(node)} onContextMenu={(event) => openNodeMenu(event, node)} onDragStart={() => setDraggedNodeId(node.id)} onDrop={() => handleDrop(node)} />)}</div></div>}
      </div>
      {selectedNodeIds.size ? <div className="tree-batch-actions"><span>已选 {selectedNodeIds.size} 项</span><Button variant="danger" onClick={() => void deleteSelected()}><Trash2 size={12} />批量移入回收站</Button><Button variant="ghost" onClick={() => setSelectedNodeIds(new Set())}>清除选择</Button></div> : null}
      <div className="sidebar-section-label"><span>工具</span></div>
      <div className="nav-list">
        <button className={cn('nav-item', activeView === 'trash' && 'active')} onClick={() => setView('trash')}><Trash2 size={15} strokeWidth={1.8} /><span>回收站</span></button>
        <button className="nav-item" onClick={() => setView('settings')}><WandSparkles size={15} strokeWidth={1.8} /><span>项目设置</span></button>
      </div>
      <div className="sidebar-tip"><FilePlus2 size={14} /><span>双击章节标题可快速重命名；删除内容会先移动到回收站。</span></div>
    </div>
  </aside>
}
