import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { BookOpen, CircleUserRound, FileSearch, Globe2, MapPin, Search, X } from 'lucide-react'
import type { EntityKind } from '../lib/types'
import { ENTITY_LABELS } from '../lib/types'
import { sortManuscriptNodes } from '../lib/planning-data'
import { useKeyboardListScroll } from '../hooks/useKeyboardListScroll'
import { useAppStore } from '../stores/app-store'
import { IconButton, TextInput } from './ui'

interface QuickOpenItem {
  id: string
  kind: 'node' | EntityKind
  title: string
  detail: string
}

function itemIcon(item: QuickOpenItem) {
  if (item.kind === 'node') return BookOpen
  if (item.kind === 'character') return CircleUserRound
  if (item.kind === 'location') return MapPin
  if (item.kind === 'world') return Globe2
  return FileSearch
}

export function QuickOpen() {
  const data = useAppStore((state) => state.data)
  const selectNode = useAppStore((state) => state.selectNode)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listId = useId()
  const { listRef, keyboard } = useKeyboardListScroll(open, query, activeIndex)

  const items = useMemo<QuickOpenItem[]>(() => {
    if (!data) return []
    const nodes = sortManuscriptNodes(data.nodes)
      .map((node) => ({ id: node.id, kind: 'node' as const, title: node.title, detail: node.kind === 'chapter' ? '正文 · 章节' : '正文 · 小节' }))
    const entities = data.entities
      .filter((entity) => entity.kind !== 'attachment')
      .map((entity) => ({ id: entity.id, kind: entity.kind, title: entity.title, detail: ENTITY_LABELS[entity.kind] }))
    return [...nodes, ...entities]
  }, [data])

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const filtered = normalized ? items.filter((item) => (item.title + item.detail).toLocaleLowerCase().includes(normalized)) : items
    return filtered.sort((left, right) => {
      if (!normalized) return 0
      const leftStarts = left.title.toLocaleLowerCase().startsWith(normalized)
      const rightStarts = right.title.toLocaleLowerCase().startsWith(normalized)
      return Number(rightStarts) - Number(leftStarts) || left.title.localeCompare(right.title, 'zh-CN')
    }).slice(0, 80)
  }, [items, query])

  useEffect(() => {
    const onOpen = () => {
      setOpen(true)
      setQuery('')
      setActiveIndex(0)
    }
    window.addEventListener('novelforge:quick-open', onOpen)
    return () => window.removeEventListener('novelforge:quick-open', onOpen)
  }, [])

  const openItem = useCallback((item: QuickOpenItem) => {
    setOpen(false)
    if (item.kind === 'node') void selectNode(item.id)
    else selectEntity(item.kind, item.id)
  }, [selectEntity, selectNode])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.target instanceof Element && event.target.closest('button')) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        keyboard.current = true
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex(current => visible.length ? (current + step + visible.length) % visible.length : 0)
      } else if (event.key === 'Enter' && visible[activeIndex]) {
        event.preventDefault()
        openItem(visible[activeIndex])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, keyboard, open, openItem, visible])

  useEffect(() => {
    if (activeIndex >= visible.length) setActiveIndex(Math.max(0, visible.length - 1))
  }, [activeIndex, visible.length])

  if (!open || !data) return null
  return <div className="quick-open-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
    <div className="quick-open" role="dialog" aria-modal="true" aria-label="快速打开">
      <div className="quick-open-head"><div className="quick-open-search"><Search size={16} /><TextInput autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} placeholder="输入章节、人物、地点或 Wiki 名称…" aria-label="快速打开搜索" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={visible[activeIndex] ? listId + '-' + activeIndex : undefined} /></div><IconButton icon={X} label="关闭快速打开" onClick={() => setOpen(false)} /></div>
      <div className="quick-open-list" id={listId} ref={listRef} role="listbox" aria-label="可打开的条目">{visible.length ? visible.map((item, index) => {
        const Icon = itemIcon(item)
        return <button type="button" id={listId + '-' + index} role="option" tabIndex={-1} aria-selected={index === activeIndex} className={'quick-open-row' + (index === activeIndex ? ' active' : '')} key={item.kind + ':' + item.id}
          onPointerMove={() => { keyboard.current = false; setActiveIndex(index) }} onClick={() => openItem(item)}><Icon size={15} /><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>
      }) : <div className="quick-open-empty"><FileSearch size={22} /><span>没有找到可打开的条目</span></div>}</div>
      <div className="quick-open-foot">↑↓选择 · Enter 打开 · Esc 关闭</div>
    </div>
  </div>
}
