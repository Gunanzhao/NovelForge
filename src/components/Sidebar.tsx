import {
ArrowDown,
ArrowRightLeft,
ArrowUp,
BookOpen,
ChevronDown,
ChevronRight,
Copy,
FileDown,
FilePlus2,
Plus,
Search,
Trash2,
WandSparkles,
X,
} from 'lucide-react'
import {
useEffect,
useMemo,
useRef,
useState,
type MouseEvent as ReactMouseEvent,
} from 'react'
import { CHAPTER_STAGES,chapterStage } from '../lib/chapter-workflow'
import { writeClipboardText } from '../lib/clipboard'
import type { ContextMenuItem } from '../lib/context-menu'
import type { NodeKind,NodeRecord } from '../lib/types'
import { useAppStore } from '../stores/app-store'
import { useContextMenu } from './ContextMenu'
import { Navigation } from './sidebar/Navigation'
import { NodeRow } from './sidebar/NodeRow'
import { filterTreeByTitle,flattenTree } from './sidebar/tree'

import type { ChapterWorkflowFilter } from '../lib/chapter-workflow'
import { chapterMatchesWorkflowFilter } from '../lib/chapter-workflow'
import { cn } from '../lib/utils'
import { Button,IconButton } from './ui'

export function Sidebar({
  onAddNode,
  onMoveNode,
  onCopyNode,
  onExportNode,
}: {
  onAddNode: (kind: NodeKind, parentId: string | null) => void
  onMoveNode: (node: NodeRecord) => void
  onCopyNode: (node: NodeRecord) => void
  onExportNode: (node: NodeRecord) => void
}) {
  const data = useAppStore((state) => state.data)
  const activeView = useAppStore((state) => state.activeView)
  const currentNodeId = useAppStore((state) => state.document?.node.id)

  const setView = useAppStore((state) => state.setView)
  const selectNode = useAppStore((state) => state.selectNode)

  const renameNode = useAppStore((state) => state.renameNode)
  const deleteNode = useAppStore((state) => state.deleteNode)
  const setNodeStatus = useAppStore((state) => state.setNodeStatus)
  const setChapterStage = useAppStore((state) => state.setChapterStage)
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
  const [workflowFilter, setWorkflowFilter] =
    useState<ChapterWorkflowFilter>('all')

  const [chapterQuery, setChapterQuery] = useState('')

  const workflowNodes = useMemo(() => {
    if (!data || workflowFilter === 'all') return data?.nodes ?? []
    const matchingChapters = new Set(
      data.nodes
        .filter(
          (node) =>
            node.kind === 'chapter' &&
            chapterMatchesWorkflowFilter(node, data.entities, workflowFilter),
        )
        .map((node) => node.id),
    )
    const matchingVolumes = new Set(
      data.nodes
        .filter(
          (node) => node.kind === 'chapter' && matchingChapters.has(node.id),
        )
        .map((node) => node.parentId),
    )
    return data.nodes.filter((node) =>
      node.kind === 'volume'
        ? matchingVolumes.has(node.id)
        : node.kind === 'chapter'
          ? matchingChapters.has(node.id)
          : matchingChapters.has(node.parentId ?? ''),
    )
  }, [data, workflowFilter])
  const filteredNodes = useMemo(
    () => filterTreeByTitle(workflowNodes, chapterQuery),
    [workflowNodes, chapterQuery],
  )
  useEffect(() => {
    setTreeScrollTop(0)
    if (treeRef.current) treeRef.current.scrollTop = 0
  }, [chapterQuery, workflowFilter])
  useEffect(() => {
    if (chapterQuery.trim())
      setOpenNodes(
        (current) =>
          new Set([
            ...current,
            ...filteredNodes
              .filter((node) => node.kind !== 'section')
              .map((node) => node.id),
          ]),
      )
  }, [chapterQuery, filteredNodes])
  const volumes = useMemo(
    () =>
      filteredNodes
        .filter((node) => node.kind === 'volume')
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [filteredNodes],
  )
  const flatTree = useMemo(
    () => flattenTree(filteredNodes, volumes, openNodes),
    [filteredNodes, openNodes, volumes],
  )
  const treeRowHeight = 38
  const treeOverscan = 10
  const visibleStart = Math.max(
    0,
    Math.floor(treeScrollTop / treeRowHeight) - treeOverscan,
  )
  const visibleEnd = Math.min(
    flatTree.length,
    Math.ceil((treeScrollTop + treeViewportHeight) / treeRowHeight) +
      treeOverscan,
  )
  const visibleTree = flatTree.slice(visibleStart, visibleEnd)

  useEffect(() => {
    const element = treeRef.current
    if (!element) return
    const updateHeight = () =>
      setTreeViewportHeight(element.clientHeight || 480)
    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  const nodes = data?.nodes
  useEffect(() => {
    if (!currentNodeId || !nodes) return
    const parents: string[] = []
    let node = nodes.find((item) => item.id === currentNodeId)
    while (node?.parentId && !parents.includes(node.parentId)) {
      parents.push(node.parentId)
      node = nodes.find((item) => item.id === node?.parentId)
    }
    setOpenNodes((current) => new Set([...current, ...parents]))
  }, [currentNodeId, nodes])

  if (!data) return null
  const currentData = data

  const toggle = (id: string) =>
    setOpenNodes((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const handleRename = (node: NodeRecord) => {
    const title = window.prompt('重命名', node.title)
    if (title?.trim() && title.trim() !== node.title)
      void renameNode(node.id, title.trim())
  }
  const handleDelete = (node: NodeRecord) => {
    if (
      window.confirm(
        '将“' + node.title + '”移入回收站？正文文件可在回收站恢复。',
      )
    )
      void deleteNode(node.id)
  }
  const toggleSelection = (id: string) =>
    setSelectedNodeIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  async function deleteSelected() {
    const selected = currentData.nodes.filter((node) =>
      selectedNodeIds.has(node.id),
    )
    const roots = selected.filter(
      (node) => !selected.some((candidate) => candidate.id === node.parentId),
    )
    if (
      !roots.length ||
      !window.confirm(
        '将选中的 ' + String(roots.length) + ' 个节点移入回收站？',
      )
    )
      return
    try {
      for (const node of roots) await deleteNode(node.id)
      setSelectedNodeIds(new Set())
    } catch {
      // Store 已经显示具体错误，保留剩余选择方便继续处理。
    }
  }
  function siblingNodes(node: NodeRecord) {
    return currentData.nodes
      .filter(
        (candidate) =>
          candidate.kind === node.kind && candidate.parentId === node.parentId,
      )
      .sort((a, b) => a.orderIndex - b.orderIndex)
  }
  async function updateChecklistShortcut(
    node: NodeRecord,
    mode: 'body' | 'final',
  ) {
    if (node.kind !== 'chapter' || !projectPath) return
    await useAppStore
      .getState()
      .updateChapterChecklist(node.id, (value) =>
        mode === 'final'
          ? { ...value, workflowStatus: 'final' }
          : {
              ...value,
              items: value.items.map((item) =>
                item.id === 'body-complete' || item.label === '正文完成'
                  ? { ...item, completed: true }
                  : item,
              ),
            },
      )
  }
  function openNodeMenu(event: ReactMouseEvent<HTMLElement>, node: NodeRecord) {
    const preservingSelection =
      selectedNodeIds.has(node.id) && selectedNodeIds.size > 1
    const ids = preservingSelection ? [...selectedNodeIds] : [node.id]
    if (
      !preservingSelection &&
      (!selectedNodeIds.has(node.id) || selectedNodeIds.size !== 1)
    )
      setSelectedNodeIds(new Set([node.id]))
    const selectedNodes = currentData.nodes.filter((candidate) =>
      ids.includes(candidate.id),
    )
    if (preservingSelection) {
      const allChapters =
        selectedNodes.length > 0 &&
        selectedNodes.every((candidate) => candidate.kind === 'chapter')
      const statusItems: ContextMenuItem[] = allChapters
        ? CHAPTER_STAGES.map(({ id: status, label }) => ({
            type: 'item' as const,
            id: 'selection-status-' + status,
            label,
            checked: selectedNodes.every(
              (candidate) =>
                chapterStage(candidate, currentData.entities) === status,
            ),
            onSelect: async () => {
              for (const candidate of selectedNodes)
                await setChapterStage(candidate.id, status)
            },
          }))
        : []
      const items: ContextMenuItem[] = [
        ...(allChapters
          ? [
              {
                type: 'item' as const,
                id: 'selection-status',
                label: '批量设置写作阶段',
                children: statusItems,
                onSelect: () => undefined,
              },
            ]
          : []),
        {
          type: 'item',
          id: 'selection-trash',
          label: '批量移入回收站',
          icon: Trash2,
          tone: 'danger',
          onSelect: () => void deleteSelected(),
        },
        { type: 'separator' },
        {
          type: 'item',
          id: 'selection-clear',
          label: '清除选择',
          onSelect: () => setSelectedNodeIds(new Set()),
        },
      ]
      openContextMenu(event, {
        title: '已选 ' + String(ids.length) + ' 项',
        location: 'tree.selection',
        payload: {
          location: 'tree.selection',
          projectPath: projectPath ?? undefined,
          nodeIds: ids,
        },
        items,
        trigger: event.currentTarget,
      })
      return
    }
    const siblings = siblingNodes(node)
    const siblingIndex = siblings.findIndex(
      (candidate) => candidate.id === node.id,
    )
    const location = ('tree.' + node.kind) as
      | 'tree.volume'
      | 'tree.chapter'
      | 'tree.section'
    const copyPath = async () => {
      if (!(await writeClipboardText(node.filePath)))
        setError('无法访问系统剪贴板，请改用 Ctrl+C。')
    }
    const items: ContextMenuItem[] = [
      {
        type: 'item',
        id: 'node-open',
        label:
          node.kind === 'volume'
            ? openNodes.has(node.id)
              ? '收起'
              : '展开'
            : '打开',
        icon:
          node.kind === 'volume'
            ? openNodes.has(node.id)
              ? ChevronDown
              : ChevronRight
            : BookOpen,
        onSelect: () =>
          node.kind === 'volume' ? toggle(node.id) : void selectNode(node.id),
      },
      ...(node.kind !== 'section'
        ? [
            {
              type: 'item' as const,
              id: 'node-add',
              label: node.kind === 'volume' ? '新建章节' : '新建小节',
              icon: Plus,
              onSelect: () =>
                onAddNode(
                  node.kind === 'volume' ? 'chapter' : 'section',
                  node.id,
                ),
            },
          ]
        : []),
      {
        type: 'item',
        id: 'node-rename',
        label: '重命名',
        onSelect: () => handleRename(node),
      },
      {
        type: 'item',
        id: 'node-copy',
        label:
          node.kind === 'volume'
            ? '复制整卷'
            : node.kind === 'chapter'
              ? '复制章节'
              : '复制小节',
        icon: Copy,
        onSelect: () => onCopyNode(node),
      },
      ...(node.kind !== 'volume'
        ? [
            {
              type: 'item' as const,
              id: 'node-move',
              label:
                node.kind === 'chapter' ? '移动到其他卷' : '移动到其他章节',
              icon: ArrowRightLeft,
              onSelect: () => onMoveNode(node),
            },
          ]
        : []),
      {
        type: 'item',
        id: 'node-up',
        label: '上移',
        icon: ArrowUp,
        disabled: siblingIndex <= 0,
        onSelect: () => void reorderNode(node.id, 'up'),
      },
      {
        type: 'item',
        id: 'node-down',
        label: '下移',
        icon: ArrowDown,
        disabled: siblingIndex < 0 || siblingIndex >= siblings.length - 1,
        onSelect: () => void reorderNode(node.id, 'down'),
      },
      ...(node.kind === 'chapter'
        ? [
            {
              type: 'item' as const,
              id: 'node-status',
              label: '写作阶段',
              children: CHAPTER_STAGES.map(({ id: status, label }) => ({
                type: 'item' as const,
                id: 'node-status-' + status,
                label,
                checked: chapterStage(node, currentData.entities) === status,
                onSelect: () =>
                  void setChapterStage(node.id, status).catch(() => undefined),
              })),
              onSelect: () => undefined,
            },
          ]
        : []),
      ...(node.kind === 'chapter'
        ? [
            {
              type: 'item' as const,
              id: 'node-checklist',
              label: '检查清单',
              children: [
                {
                  type: 'item' as const,
                  id: 'node-checklist-body',
                  label: '标记正文完成',
                  onSelect: () =>
                    void updateChecklistShortcut(node, 'body').catch(
                      () => undefined,
                    ),
                },
                {
                  type: 'item' as const,
                  id: 'node-checklist-final',
                  label: '标记定稿',
                  onSelect: () =>
                    void updateChecklistShortcut(node, 'final').catch(
                      () => undefined,
                    ),
                },
              ],
              onSelect: () => undefined,
            },
          ]
        : []),
      ...(node.kind !== 'section'
        ? [
            {
              type: 'item' as const,
              id: 'node-export',
              label: node.kind === 'volume' ? '导出此卷' : '导出此章',
              icon: FileDown,
              onSelect: () => onExportNode(node),
            },
          ]
        : []),
      {
        type: 'item',
        id: 'node-lock',
        label: node.status === 'locked' ? '解锁正文' : '锁定正文',
        onSelect: () =>
          void setNodeStatus(
            node.id,
            node.status === 'locked' ? 'draft' : 'locked',
          ),
      },
      {
        type: 'item',
        id: 'node-copy-title',
        label: node.kind === 'chapter' ? '复制章节标题' : '复制标题',
        icon: Copy,
        onSelect: async () => {
          if (!(await writeClipboardText(node.title)))
            setError('无法访问系统剪贴板，请改用 Ctrl+C。')
        },
      },
      {
        type: 'item',
        id: 'node-copy-path',
        label: node.kind === 'chapter' ? '复制文件路径' : '复制目录路径',
        icon: Copy,
        onSelect: copyPath,
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'node-trash',
        label: '移入回收站',
        icon: Trash2,
        tone: 'danger',
        onSelect: () => handleDelete(node),
      },
    ]
    openContextMenu(event, {
      title: node.title,
      location,
      payload: {
        location,
        projectPath: projectPath ?? undefined,
        nodeIds: [node.id],
        nodeKind: node.kind,
      },
      items,
      trigger: event.currentTarget,
    })
  }
  function handleDrop(target: NodeRecord) {
    const source = draggedNodeId
      ? currentData.nodes.find((node) => node.id === draggedNodeId)
      : undefined
    setDraggedNodeId(null)
    if (!source || source.id === target.id) return
    if (source.parentId === target.parentId) {
      void reorderNode(
        source.id,
        source.orderIndex < target.orderIndex ? 'down' : 'up',
      )
      return
    }
    if (
      (source.kind === 'chapter' && target.kind === 'volume') ||
      (source.kind === 'section' && target.kind === 'chapter')
    ) {
      void moveNode(source.id, target.id)
    }
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <div>
            <h2>项目导航</h2>
            <small>{data.project.title}</small>
          </div>
          <IconButton
            icon={Plus}
            label="新建卷"
            onClick={() => onAddNode('volume', null)}
          />
        </div>
        <Navigation />
        <div className="sidebar-section-label">
          <span>正文结构</span>
          <span>
            {data.nodes.filter((node) => node.kind === 'chapter').length} 章
          </span>
        </div>
        <div className="chapter-search">
          <Search size={13} />
          <input
            aria-label="查找章节"
            placeholder="查找卷、章或小节…"
            value={chapterQuery}
            onChange={(event) => setChapterQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setChapterQuery('')
              }
            }}
          />
          {chapterQuery && (
            <IconButton
              icon={X}
              label="清除章节搜索"
              onClick={() => setChapterQuery('')}
            />
          )}
        </div>
        <select
          className="select-input workflow-tree-filter"
          value={workflowFilter}
          onChange={(event) => {
            setWorkflowFilter(event.target.value as ChapterWorkflowFilter)
            setTreeScrollTop(0)
          }}
          aria-label="章节 Checklist 过滤"
        >
          <option value="all">显示全部章节</option>
          <option value="incomplete">仅显示检查未完成</option>
          <option value="not-final">仅显示未定稿</option>
          <option value="consistency">仅显示待人物一致性检查</option>
        </select>
        <div
          className="tree"
          ref={treeRef}
          onScroll={(event) => setTreeScrollTop(event.currentTarget.scrollTop)}
        >
          {volumes.length === 0 ? (
            <div className="tree-muted">
              {data.nodes.some((node) => node.kind === 'volume')
                ? '没有匹配的章节，试试其他名称或筛选条件。'
                : '还没有卷，点击右上角创建第一卷。'}
            </div>
          ) : (
            <div
              className="tree-virtual-content"
              style={{ height: flatTree.length * treeRowHeight }}
            >
              <div
                className="tree-virtual-rows"
                style={{ top: visibleStart * treeRowHeight }}
              >
                {visibleTree.map(({ node, level }) => (
                  <NodeRow
                    key={node.id}
                    node={node}
                    level={level}
                    open={openNodes.has(node.id)}
                    selected={selectedNodeIds.has(node.id)}
                    onToggle={() => toggle(node.id)}
                    onSelect={() =>
                      node.kind === 'volume'
                        ? toggle(node.id)
                        : void selectNode(node.id)
                    }
                    onSelectToggle={() => toggleSelection(node.id)}
                    onRename={() => handleRename(node)}
                    onContextMenu={(event) => openNodeMenu(event, node)}
                    onDragStart={() => setDraggedNodeId(node.id)}
                    onDrop={() => handleDrop(node)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        {selectedNodeIds.size ? (
          <div className="tree-batch-actions">
            <span>已选 {selectedNodeIds.size} 项</span>
            <Button variant="danger" onClick={() => void deleteSelected()}>
              <Trash2 size={12} />
              批量移入回收站
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelectedNodeIds(new Set())}
            >
              清除选择
            </Button>
          </div>
        ) : null}
        <div className="sidebar-section-label">
          <span>工具</span>
        </div>
        <div className="nav-list">
          <button
            className={cn('nav-item', activeView === 'trash' && 'active')}
            onClick={() => setView('trash')}
          >
            <Trash2 size={15} strokeWidth={1.8} />
            <span>回收站</span>
          </button>
          <button className="nav-item" onClick={() => setView('settings')}>
            <WandSparkles size={15} strokeWidth={1.8} />
            <span>项目设置</span>
          </button>
        </div>
        <div className="sidebar-tip">
          <FilePlus2 size={14} />
          <span>双击章节标题可快速重命名；删除内容会先移动到回收站。</span>
        </div>
      </div>
    </aside>
  )
}
