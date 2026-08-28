import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen, ChevronDown, ChevronRight, CircleUserRound, Clock3, FilePlus2, FolderTree,
  GalleryVerticalEnd, GitBranch, Globe2, LayoutDashboard, MoreHorizontal, Plus, Search,
  Trash2, WandSparkles, X,
} from 'lucide-react'
import { useAppStore } from '../stores/app-store'
import type { NodeKind, NodeRecord, ViewId } from '../lib/types'

import { cn } from '../lib/utils'
import { IconButton } from './ui'

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: '总览', icon: LayoutDashboard },
  { id: 'manuscript', label: '正文', icon: BookOpen },
  { id: 'outline', label: '写作规划', icon: BookOpen },
  { id: 'character', label: '人物', icon: CircleUserRound },
  { id: 'location', label: '地点', icon: GalleryVerticalEnd },
  { id: 'world', label: '世界观 Wiki', icon: Globe2 },
  { id: 'timeline', label: '时间线', icon: Clock3 },
  { id: 'foreshadowing', label: '伏笔', icon: GitBranch },
]

function nodeChildren(nodes: NodeRecord[], parentId: string) {
  return nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)
}

function NodeRow({ node, level, open, onToggle, onSelect, onAdd, onRename, onDelete }: {
  node: NodeRecord
  level: number
  open: boolean
  onToggle: () => void
  onSelect: () => void
  onAdd: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const isContainer = node.kind !== 'section'
  const hasChildren = isContainer
  return <div className="tree-row-wrap">
    <div className={cn('tree-row', node.kind !== 'volume' && 'tree-document-row')} style={{ paddingLeft: 5 + level * 13 }} onDoubleClick={onRename}>
      {hasChildren ? <IconButton icon={open ? ChevronDown : ChevronRight} label={open ? '收起' : '展开'} onClick={onToggle} className="tree-toggle" /> : <span style={{ width: 30 }} />}
      <button className="tree-main-button" onClick={onSelect}>
        <span className="tree-icon">{node.kind === 'volume' ? <FolderTree size={15} /> : <BookOpen size={14} />}</span>
        <span className="tree-label">{node.title}</span>
        {node.kind === 'chapter' ? <span className={cn('tree-status-dot', node.status)} /> : null}
      </button>
      <span className="tree-row-actions">
        {node.kind !== 'section' ? <IconButton icon={Plus} label={'在此新建' + (node.kind === 'volume' ? '章' : '节')} onClick={onAdd} /> : null}
        <IconButton icon={MoreHorizontal} label="更多操作" onClick={onRename} />
        <IconButton icon={X} label="移入回收站" onClick={onDelete} />
      </span>
    </div>
  </div>
}

export function Sidebar({ onAddNode }: { onAddNode: (kind: NodeKind, parentId: string | null) => void }) {
  const data = useAppStore((state) => state.data)
  const activeView = useAppStore((state) => state.activeView)

  const setView = useAppStore((state) => state.setView)
  const selectNode = useAppStore((state) => state.selectNode)

  const renameNode = useAppStore((state) => state.renameNode)
  const deleteNode = useAppStore((state) => state.deleteNode)
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set())

  if (!data) return null
  const volumes = data.nodes.filter((node) => node.kind === 'volume').sort((a, b) => a.orderIndex - b.orderIndex)
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
  const renderChildren = (parent: NodeRecord, level: number) => {
    if (!openNodes.has(parent.id)) return null
    return <div className="tree-children">{nodeChildren(data.nodes, parent.id).map((child) => <div key={child.id}>
      <NodeRow node={child} level={level} open={openNodes.has(child.id)} onToggle={() => toggle(child.id)} onSelect={() => void selectNode(child.id)} onAdd={() => onAddNode(child.kind === 'volume' ? 'chapter' : 'section', child.id)} onRename={() => handleRename(child)} onDelete={() => handleDelete(child)} />
      {renderChildren(child, level + 1)}
    </div>)}</div>
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
      <div className="tree">
        {volumes.length === 0 ? <div className="tree-muted">还没有卷，点击右上角创建第一卷。</div> : volumes.map((volume) => <div className="tree-volume" key={volume.id}>
          <NodeRow node={volume} level={0} open={openNodes.has(volume.id)} onToggle={() => toggle(volume.id)} onSelect={() => toggle(volume.id)} onAdd={() => onAddNode('chapter', volume.id)} onRename={() => handleRename(volume)} onDelete={() => handleDelete(volume)} />
          {renderChildren(volume, 1)}
        </div>)}
      </div>
      <div className="sidebar-section-label"><span>工具</span></div>
      <div className="nav-list">
        <button className={cn('nav-item', activeView === 'trash' && 'active')} onClick={() => setView('trash')}><Trash2 size={15} strokeWidth={1.8} /><span>回收站</span></button>
        <button className="nav-item" onClick={() => setView('settings')}><WandSparkles size={15} strokeWidth={1.8} /><span>项目设置</span></button>
      </div>
      <div className="sidebar-tip"><FilePlus2 size={14} /><span>双击章节标题可快速重命名；删除内容会先移动到回收站。</span></div>
    </div>
  </aside>
}
