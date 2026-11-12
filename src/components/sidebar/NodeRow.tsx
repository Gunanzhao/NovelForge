import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderTree,
  MoreHorizontal,
} from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { chapterStage, chapterStageLabel } from '../../lib/chapter-workflow'
import { isNodeLocked } from '../../lib/node-lock'
import type { NodeRecord } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../stores/app-store'
import { IconButton } from '../ui'

export function NodeRow({
  node,
  level,
  open,
  selected,
  onToggle,
  onSelect,
  onSelectToggle,
  onRename,
  onContextMenu,
  onDragStart,
  onDrop,
}: {
  node: NodeRecord
  level: number
  open: boolean
  selected: boolean
  onToggle: () => void
  onSelect: () => void
  onSelectToggle: () => void
  onRename: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  onDragStart: () => void
  onDrop: () => void
}) {
  const current = useAppStore((state) => state.document?.node.id === node.id)
  const data = useAppStore((state) => state.data)
  const stage = chapterStage(node, data?.entities ?? [])
  const isContainer = node.kind !== 'section'
  const hasChildren = isContainer
  return (
    <div className="tree-row-wrap">
      <div
        className={cn(
          'tree-row',
          node.kind !== 'volume' && 'tree-document-row',
          selected && 'selected',
          current && 'current',
        )}
        style={{ paddingLeft: 5 + level * 13 }}
        draggable
        onDragStart={onDragStart}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          onDrop()
        }}
        onDoubleClick={onRename}
        onContextMenu={onContextMenu}
      >
        {hasChildren ? (
          <IconButton
            icon={open ? ChevronDown : ChevronRight}
            label={open ? '收起' : '展开'}
            onClick={onToggle}
            className="tree-toggle"
          />
        ) : (
          <span style={{ width: 30 }} />
        )}
        <input
          type="checkbox"
          className="tree-checkbox"
          checked={selected}
          onChange={onSelectToggle}
          onClick={(event) => event.stopPropagation()}
          aria-label={'选择' + node.title}
        />
        <button
          className="tree-main-button"
          aria-current={current ? 'page' : undefined}
          onClick={onSelect}
        >
          <span className="tree-icon">
            {node.kind === 'volume' ? (
              <FolderTree size={15} />
            ) : (
              <BookOpen size={14} />
            )}
          </span>
          <span className="tree-label">{node.title}</span>
          {node.kind === 'chapter' ? (
            <span
              title={
                chapterStageLabel(node, data?.entities ?? []) +
                (isNodeLocked(data?.nodes ?? [], node.id) ? ' · 已锁定' : '')
              }
              className={cn(
                'tree-status-dot',
                stage === 'final' ? 'done' : stage,
              )}
            />
          ) : null}
        </button>
        <span className="tree-row-actions">
          <IconButton
            icon={MoreHorizontal}
            label={'更多操作：' + node.title}
            aria-haspopup="menu"
            onClick={onContextMenu}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        </span>
      </div>
    </div>
  )
}
