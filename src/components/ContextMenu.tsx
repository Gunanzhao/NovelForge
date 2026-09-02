import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Check, ChevronRight, Copy, Image as ImageIcon, Redo2, Scissors, Undo2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  clampContextMenuPosition, firstEnabledContextMenuIndex, isContextMenuAction,
  normalizeContextMenuItems, submenuContextMenuPosition, type ContextMenuActionItem,
  type ContextMenuItem, type ContextMenuLocation, type ContextMenuOpenOptions, type ContextMenuPayload,
} from '../lib/context-menu'
import {
  deleteTextControlSelection, readClipboardText, replaceTextControlSelection,
  textControlSelection, writeClipboardText, type TextControl,
} from '../lib/clipboard'
import { useAppStore } from '../stores/app-store'

interface ContextMenuContextValue {
  openContextMenu: (event: ReactMouseEvent<HTMLElement> | MouseEvent, options: ContextMenuOpenOptions) => void
  closeContextMenu: () => void
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null)

interface ContextMenuProviderProps {
  children: ReactNode
  fallbackItems: ContextMenuItem[] | (() => ContextMenuItem[])
  pluginItems?: (location: ContextMenuLocation, payload: ContextMenuPayload) => ContextMenuItem[]
}

interface MenuState extends ContextMenuOpenOptions {
  point: { x: number; y: number }
}

interface ContextMenuSurfaceProps {
  state: MenuState
  onClose: () => void
  onError: (error: unknown) => void
}

function textControlMenu(target: TextControl, setError: (error: unknown) => void): ContextMenuItem[] {
  const selection = textControlSelection(target)
  const isPassword = target instanceof HTMLInputElement && target.type === 'password'
  const canEdit = !target.disabled && !target.readOnly
  return [
    { type: 'item', id: 'input-undo', label: '撤销', icon: Undo2, disabled: !canEdit, onSelect: () => { target.focus(); document.execCommand('undo') } },
    { type: 'item', id: 'input-redo', label: '重做', icon: Redo2, disabled: !canEdit, onSelect: () => { target.focus(); document.execCommand('redo') } },
    { type: 'separator' },
    {
      type: 'item',
      id: 'input-cut',
      label: '剪切',
      icon: Scissors,
      shortcut: 'Ctrl+X',
      disabled: !canEdit || isPassword || !selection.text,
      onSelect: async () => {
        if (!await writeClipboardText(selection.text)) {
          setError('无法访问系统剪贴板，请改用 Ctrl+X。')
          return
        }
        deleteTextControlSelection(target)
      },
    },
    {
      type: 'item',
      id: 'input-copy',
      label: '复制',
      icon: Copy,
      shortcut: 'Ctrl+C',
      disabled: isPassword || !selection.text,
      onSelect: async () => {
        if (!await writeClipboardText(selection.text)) setError('无法访问系统剪贴板，请改用 Ctrl+C。')
      },
    },
    {
      type: 'item',
      id: 'input-paste',
      label: '粘贴',
      shortcut: 'Ctrl+V',
      disabled: !canEdit,
      onSelect: async () => {
        const result = await readClipboardText(target)
        if (result.nativeApplied) return
        if (result.ok && typeof result.text === 'string') {
          replaceTextControlSelection(target, result.text)
          return
        }
        setError('无法访问系统剪贴板，请改用 Ctrl+V。')
      },
    },
    { type: 'separator' },
    { type: 'item', id: 'input-select-all', label: '全选', shortcut: 'Ctrl+A', onSelect: () => { target.focus(); target.select() } },
  ]
}

function fallbackItemsForTarget(
  target: EventTarget | null,
  fallbackItems: ContextMenuItem[],
  setError: (error: unknown) => void,
): { location: ContextMenuLocation; payload: ContextMenuPayload; title?: string; items: ContextMenuItem[] } {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (target instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color'].includes(target.type)) {
      return { location: 'workspace', payload: { location: 'workspace' }, items: fallbackItems }
    }
    return { location: 'input.text', payload: { location: 'input.text' }, title: target.getAttribute('aria-label') ?? undefined, items: textControlMenu(target, setError) }
  }
  if (target instanceof HTMLSelectElement) {
    const option = target.selectedOptions[0]
    return {
      location: 'input.select',
      payload: { location: 'input.select', selectionText: option?.text ?? '' },
      title: target.getAttribute('aria-label') ?? undefined,
      items: [{ type: 'item', id: 'select-copy', label: '复制当前选项', icon: Copy, disabled: !option, onSelect: async () => { if (option && !await writeClipboardText(option.text)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } }],
    }
  }
  const anchor = target instanceof Element ? target.closest('a[href]') : null
  if (anchor instanceof HTMLAnchorElement) {
    const text = anchor.textContent?.trim() ?? ''
    return {
      location: 'link',
      payload: { location: 'link', selectionText: text },
      title: text || undefined,
      items: [
        { type: 'item', id: 'link-open', label: '打开链接', onSelect: () => anchor.click() },
        { type: 'item', id: 'link-copy-text', label: '复制链接文字', icon: Copy, disabled: !text, onSelect: async () => { if (!await writeClipboardText(text)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
        { type: 'item', id: 'link-copy-url', label: '复制链接地址', icon: Copy, onSelect: async () => { if (!await writeClipboardText(anchor.href)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      ],
    }
  }
  const image = target instanceof Element ? target.closest('img') : null
  if (image instanceof HTMLImageElement) {
    const alt = image.alt.trim()
    return {
      location: 'image',
      payload: { location: 'image', selectionText: alt },
      items: [
        { type: 'item', id: 'image-copy-alt', label: '复制替代文本', icon: Copy, disabled: !alt, onSelect: async () => { if (!await writeClipboardText(alt)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
        { type: 'item', id: 'image-copy-url', label: '复制图片地址', icon: ImageIcon, disabled: image.src.startsWith('data:'), onSelect: async () => { if (!await writeClipboardText(image.src)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      ],
    }
  }
  const selection = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() ?? '' : ''
  if (selection) {
    return {
      location: 'editor.preview',
      payload: { location: 'editor.preview', selectionText: selection },
      items: [
        { type: 'item', id: 'selection-copy', label: '复制', icon: Copy, shortcut: 'Ctrl+C', onSelect: async () => { if (!await writeClipboardText(selection)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
        ...fallbackItems,
      ],
    }
  }
  return { location: 'workspace', payload: { location: 'workspace' }, items: fallbackItems }
}

function MenuItemButton({
  item,
  active,
  onSelect,
  onOpenSubmenu,
  registerRef,
}: {
  item: ContextMenuActionItem
  active: boolean
  onSelect: (item: ContextMenuActionItem) => void
  onOpenSubmenu: (item: ContextMenuActionItem, element: HTMLButtonElement) => void
  registerRef: (id: string, element: HTMLButtonElement | null) => void
}) {
  return <button
    ref={(element) => registerRef(item.id, element)}
    type="button"
    role="menuitem"
    tabIndex={active ? 0 : -1}
    className={'context-menu-item' + (item.tone === 'danger' ? ' danger' : '') + (item.tone === 'accent' ? ' accent' : '')}
    disabled={item.disabled}
    aria-disabled={item.disabled || undefined}
    aria-checked={item.checked || undefined}
    aria-haspopup={item.children?.length ? 'menu' : undefined}
    aria-expanded={item.children?.length && active ? true : undefined}
    onMouseEnter={(event) => item.children?.length ? onOpenSubmenu(item, event.currentTarget) : undefined}
    onFocus={(event) => item.children?.length ? onOpenSubmenu(item, event.currentTarget) : undefined}
    onClick={(event) => item.children?.length ? onOpenSubmenu(item, event.currentTarget) : onSelect(item)}
  >
    <span className="context-menu-item-icon">{item.checked ? <Check size={15} strokeWidth={1.8} /> : item.icon ? <item.icon size={15} strokeWidth={1.8} /> : null}</span>
    <span className="context-menu-item-label">{item.label}</span>
    {item.shortcut ? <span className="context-menu-shortcut">{item.shortcut}</span> : null}
    {item.children?.length ? <ChevronRight size={14} className="context-menu-chevron" /> : null}
  </button>
}

function ContextMenuSurface({ state, onClose, onError }: ContextMenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [position, setPosition] = useState({ left: state.point.x, top: state.point.y })
  const [activeIndex, setActiveIndex] = useState(0)
  const [submenu, setSubmenu] = useState<{ item: ContextMenuActionItem; anchor: DOMRect } | null>(null)
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState(0)
  const items = useMemo(() => normalizeContextMenuItems(state.items), [state.items])
  const enabledItems = useMemo(() => items.filter(isContextMenuAction), [items])

  const registerRef = useCallback((id: string, element: HTMLButtonElement | null) => {
    itemRefs.current[id] = element
  }, [])

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    const menu = menuRef.current
    setPosition(clampContextMenuPosition(state.point, { width: menu?.offsetWidth || rect.width || 236, height: menu?.offsetHeight || rect.height || 80 }, { width: window.innerWidth, height: window.innerHeight }))
  }, [state.point, items.length, state.title])

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    const first = firstEnabledContextMenuIndex(items)
    setActiveIndex(first >= 0 ? first : 0)
    window.requestAnimationFrame(() => itemRefs.current[items[first >= 0 ? first : 0] && isContextMenuAction(items[first >= 0 ? first : 0]) ? (items[first >= 0 ? first : 0] as ContextMenuActionItem).id : '']?.focus())
  }, [items])

  useEffect(() => {
    if (!submenu || !submenuRef.current) return
    setSubmenuActiveIndex(0)
    const rect = submenuRef.current.getBoundingClientRect()
    const submenuElement = submenuRef.current
    const next = submenuContextMenuPosition(submenu.anchor, { width: submenuElement.offsetWidth || rect.width || 220, height: submenuElement.offsetHeight || rect.height || 280 }, { width: window.innerWidth, height: window.innerHeight })
    submenuRef.current.style.left = next.left + 'px'
    submenuRef.current.style.top = next.top + 'px'
  }, [submenu])

  const selectItem = async (item: ContextMenuActionItem) => {
    if (item.disabled) return
    onClose()
    try {
      await item.onSelect()
    } catch (error) {
      onError(error)
    }
  }

  const focusEnabled = (delta: number) => {
    if (!enabledItems.length) return
    const current = Math.max(0, enabledItems.findIndex((item) => item.id === (items[activeIndex] as ContextMenuActionItem | undefined)?.id))
    const next = (current + delta + enabledItems.length) % enabledItems.length
    const item = enabledItems[next]
    const index = items.findIndex((candidate) => isContextMenuAction(candidate) && candidate.id === item.id)
    setActiveIndex(index)
    itemRefs.current[item.id]?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); focusEnabled(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusEnabled(-1) }
    else if (event.key === 'Home') { event.preventDefault(); const item = enabledItems[0]; if (item) { setActiveIndex(items.findIndex((candidate) => isContextMenuAction(candidate) && candidate.id === item.id)); itemRefs.current[item.id]?.focus() } }
    else if (event.key === 'End') { event.preventDefault(); const item = enabledItems.at(-1); if (item) { setActiveIndex(items.findIndex((candidate) => isContextMenuAction(candidate) && candidate.id === item.id)); itemRefs.current[item.id]?.focus() } }
    else if (event.key === 'ArrowRight') { if (submenu) submenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus() }
    else if (event.key === 'ArrowLeft') { if (submenu) { setSubmenu(null); itemRefs.current[submenu.item.id]?.focus() } }
    else if (event.key === 'Enter' || event.key === ' ') { const active = items[activeIndex]; if (isContextMenuAction(active)) { event.preventDefault(); void selectItem(active) } }
    else if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const needle = event.key.toLocaleLowerCase()
      const start = Math.max(0, activeIndex)
      const candidates = enabledItems.filter((item) => item.label.trim().toLocaleLowerCase().startsWith(needle))
      const next = candidates.find((item) => items.findIndex((candidate) => isContextMenuAction(candidate) && candidate.id === item.id) > start) ?? candidates[0]
      if (next) {
        event.preventDefault()
        const index = items.findIndex((candidate) => isContextMenuAction(candidate) && candidate.id === next.id)
        setActiveIndex(index)
        itemRefs.current[next.id]?.focus()
      }
    }
  }

  const onSubmenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(submenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (!buttons.length) return
      const next = (submenuActiveIndex + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      setSubmenuActiveIndex(next)
      buttons[next]?.focus()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (submenu) {
        setSubmenu(null)
        itemRefs.current[submenu.item.id]?.focus()
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      const active = document.activeElement
      if (active instanceof HTMLButtonElement) active.click()
    }
  }

  return <div
    ref={menuRef}
    className="context-menu"
    data-context-menu-surface="true"
    role="menu"
    aria-label={state.title ?? '上下文菜单'}
    style={{ left: position.left, top: position.top }}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
    onKeyDown={onKeyDown}
    onMouseLeave={(event) => {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && submenuRef.current?.contains(relatedTarget)) return
      window.setTimeout(() => {
        if (!submenuRef.current?.matches(':hover')) setSubmenu(null)
      }, 100)
    }}
  >
    {state.title ? <div className="context-menu-title">{state.title}</div> : null}
    {items.map((item, index) => item.type === 'separator'
      ? <div className="context-menu-separator" role="separator" key={'separator-' + String(index)} />
      : item.type === 'label'
        ? <div className="context-menu-label" key={item.id}>{item.label}</div>
        : <MenuItemButton key={item.id} item={item} active={index === activeIndex} onSelect={(selected) => void selectItem(selected)} onOpenSubmenu={(selected, element) => setSubmenu({ item: selected, anchor: element.getBoundingClientRect() })} registerRef={registerRef} />)}
    {submenu?.item.children?.length ? createPortal(<div
      ref={submenuRef}
      className="context-menu context-submenu"
      data-context-menu-surface="true"
      role="menu"
      aria-label={submenu.item.label}
      style={{ left: submenu.anchor.right + 4, top: submenu.anchor.top }}
      onMouseEnter={() => undefined}
      onKeyDown={onSubmenuKeyDown}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
    >
      {normalizeContextMenuItems(submenu.item.children).map((item, index) => item.type === 'separator'
        ? <div className="context-menu-separator" role="separator" key={'submenu-separator-' + String(index)} />
        : item.type === 'label'
          ? <div className="context-menu-label" key={item.id}>{item.label}</div>
          : <MenuItemButton key={item.id} item={item} active={false} onSelect={(selected) => void selectItem(selected)} onOpenSubmenu={() => undefined} registerRef={() => undefined} />)}
    </div>, document.body) : null}
  </div>
}

export function ContextMenuProvider({ children, fallbackItems, pluginItems }: ContextMenuProviderProps) {
  const [state, setState] = useState<MenuState | null>(null)
  const setError = useAppStore((store) => store.setError)
  const fallback = useMemo(() => typeof fallbackItems === 'function' ? fallbackItems() : fallbackItems, [fallbackItems])

  const closeContextMenu = useCallback(() => {
    setState((current) => {
      current?.trigger?.focus()
      return null
    })
  }, [])

  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLElement> | MouseEvent, options: ContextMenuOpenOptions) => {
    event.preventDefault()
    event.stopPropagation()
    const payload = { ...options.payload, location: options.location }
    const extensionItems = pluginItems?.(options.location, payload) ?? []
    const dangerIndex = options.items.findIndex((item) => isContextMenuAction(item) && item.tone === 'danger')
    const ordinaryItems = dangerIndex >= 0 ? options.items.slice(0, dangerIndex) : options.items
    const dangerItems = dangerIndex >= 0 ? options.items.slice(dangerIndex) : []
    const extensionGroup = extensionItems.length
      ? [{ type: 'separator' as const }, { type: 'label' as const, id: 'context-plugin-label', label: '扩展' }, ...extensionItems]
      : []
    setState({
      ...options,
      payload,
      items: [...ordinaryItems, ...extensionGroup, ...dangerItems],
      point: { x: event.clientX, y: event.clientY },
    })
  }, [pluginItems])

  useEffect(() => {
    if (!state) return
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('[data-context-menu-surface="true"]')) return
      closeContextMenu()
    }
    const onClose = () => closeContextMenu()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [closeContextMenu, state])

  const handleRootContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    const result = fallbackItemsForTarget(event.target, fallback, setError)
    openContextMenu(event as unknown as ReactMouseEvent<HTMLElement>, {
      title: result.title,
      location: result.location,
      payload: result.payload,
      items: result.items,
      trigger: event.target instanceof HTMLElement ? event.target : null,
    })
  }

  return <ContextMenuContext.Provider value={{ openContextMenu, closeContextMenu }}>
    <div className="context-menu-root" onContextMenu={handleRootContextMenu}>{children}</div>
    {state && typeof document !== 'undefined' ? createPortal(<ContextMenuSurface state={state} onClose={closeContextMenu} onError={setError} />, document.body) : null}
  </ContextMenuContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useContextMenu() {
  const value = useContext(ContextMenuContext)
  if (!value) throw new Error('useContextMenu 必须在 ContextMenuProvider 内使用')
  return value
}
