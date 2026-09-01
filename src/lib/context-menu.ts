import type { LucideIcon } from 'lucide-react'

export type ContextMenuLocation =
  | 'workspace'
  | 'input.text'
  | 'input.select'
  | 'link'
  | 'image'
  | 'tree.volume'
  | 'tree.chapter'
  | 'tree.section'
  | 'tree.selection'
  | 'editor.cursor'
  | 'editor.selection'
  | 'editor.preview'
  | 'entity.character'
  | 'entity.location'
  | 'entity.world'
  | 'attachment'
  | 'trash'
  | 'search.result'
  | 'history.revision'

export type ContextMenuTone = 'default' | 'accent' | 'danger'

export interface ContextMenuPayload {
  location: ContextMenuLocation
  projectPath?: string
  nodeIds?: string[]
  nodeKind?: 'volume' | 'chapter' | 'section'
  entityId?: string
  entityKind?: string
  trashId?: string
  selectionText?: string
}

export interface ContextMenuActionItem {
  type: 'item'
  id: string
  label: string
  icon?: LucideIcon
  shortcut?: string
  tone?: ContextMenuTone
  disabled?: boolean
  checked?: boolean
  children?: ContextMenuItem[]
  onSelect: () => void | Promise<void>
}

export type ContextMenuItem =
  | ContextMenuActionItem
  | { type: 'separator' }
  | { type: 'label'; id: string; label: string }

export interface ContextMenuOpenOptions {
  title?: string
  location: ContextMenuLocation
  payload: ContextMenuPayload
  items: ContextMenuItem[]
  trigger?: HTMLElement | null
}

export interface ContextMenuPoint {
  x: number
  y: number
}

export interface ContextMenuSize {
  width: number
  height: number
}

export interface ContextMenuViewport {
  width: number
  height: number
}

export function isContextMenuAction(item: ContextMenuItem): item is ContextMenuActionItem {
  return item.type === 'item'
}

export function normalizeContextMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
  const normalized: ContextMenuItem[] = []
  let separatorPending = false
  for (const item of items) {
    if (item.type === 'separator') {
      separatorPending = normalized.length > 0
      continue
    }
    if (separatorPending) normalized.push({ type: 'separator' })
    separatorPending = false
    normalized.push(item)
  }
  if (normalized.at(-1)?.type === 'separator') normalized.pop()
  return normalized
}

export function firstEnabledContextMenuIndex(items: ContextMenuItem[]) {
  return items.findIndex((item) => isContextMenuAction(item) && !item.disabled)
}

function clampAxis(origin: number, size: number, viewportSize: number, gap: number) {
  const max = Math.max(gap, viewportSize - size - gap)
  const preferred = origin + size > viewportSize - gap ? origin - size : origin
  return Math.min(Math.max(gap, preferred), max)
}

export function clampContextMenuPosition(
  point: ContextMenuPoint,
  size: ContextMenuSize,
  viewport: ContextMenuViewport,
  gap = 8,
) {
  return {
    left: clampAxis(point.x, size.width, viewport.width, gap),
    top: clampAxis(point.y, size.height, viewport.height, gap),
  }
}

export function submenuContextMenuPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  size: ContextMenuSize,
  viewport: ContextMenuViewport,
  gap = 4,
) {
  const right = anchor.right + gap
  const left = right + size.width <= viewport.width - gap
    ? right
    : anchor.left - size.width - gap
  return {
    left: Math.min(Math.max(gap, left), Math.max(gap, viewport.width - size.width - gap)),
    top: clampAxis(anchor.top, size.height, viewport.height, gap),
  }
}
