import { Pin, PinOff, Search } from 'lucide-react'
import { useState } from 'react'
import { navItems } from '../../app/navigation'
import {
  readPinnedNavigation,
  writePinnedNavigation,
} from '../../lib/navigation-preferences'
import type { ViewId } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../stores/app-store'
import { Disclosure } from '../Disclosure'
import { IconButton } from '../ui'

export function Navigation() {
  const data = useAppStore((state) => state.data)
  const activeView = useAppStore((state) => state.activeView)
  const setView = useAppStore((state) => state.setView)
  const [pinned, setPinned] = useState(readPinnedNavigation)
  if (!data) return null
  const currentData = data
  const primaryIds: ViewId[] = [
    'dashboard',
    'manuscript',
    'outline',
    'character',
    'ai',
  ]
  function togglePin(id: ViewId) {
    if (!pinned.includes(id) && pinned.length >= 4) return
    const next = pinned.includes(id)
      ? pinned.filter((item) => item !== id)
      : [...pinned, id].slice(-4)
    setPinned(next)
    writePinnedNavigation(next)
  }
  function navigationItem(
    { id, label, icon: Icon }: (typeof navItems)[number],
    pinnable = false,
  ) {
    return (
      <div className="nav-entry" key={id}>
        <button
          className={cn('nav-item', activeView === id && 'active')}
          aria-current={activeView === id ? 'page' : undefined}
          onClick={() => setView(id)}
        >
          <Icon size={16} strokeWidth={1.8} />
          <span>{label}</span>
          {id === 'character' ? (
            <span className="count">
              {
                currentData.entities.filter(
                  (entity) => entity.kind === 'character',
                ).length
              }
            </span>
          ) : null}
        </button>
        {pinnable && (
          <IconButton
            className="nav-pin"
            disabled={!pinned.includes(id) && pinned.length >= 4}
            title={
              !pinned.includes(id) && pinned.length >= 4
                ? '最多固定 4 项，请先取消一个固定入口'
                : undefined
            }
            icon={pinned.includes(id) ? PinOff : Pin}
            label={(pinned.includes(id) ? '取消固定' : '固定') + label}
            onClick={() => togglePin(id)}
          />
        )}
      </div>
    )
  }
  return (
    <nav className="sidebar-nav-groups" aria-label="功能导航">
      <div className="nav-list primary-navigation">
        {navItems
          .filter((item) => primaryIds.includes(item.id))
          .map((item) => navigationItem(item))}
      </div>
      <div className="nav-secondary-scroll">
        {pinned.length > 0 && (
          <div className="nav-list pinned-navigation" aria-label="固定入口">
            {pinned
              .map((id) => navItems.find((item) => item.id === id)!)
              .map((item) => navigationItem(item, true))}
          </div>
        )}
        <div className="nav-list secondary-navigation">
          {['写作', '资料', '分析与辅助'].map((group) => (
            <Disclosure
              key={group}
              title={
                group === '写作'
                  ? '更多写作工具'
                  : group === '资料'
                    ? '更多资料'
                    : group
              }
              storageKey={'compact-nav:' + group}
              meta={
                navItems.find(
                  (item) =>
                    item.group === group &&
                    item.id === activeView &&
                    !primaryIds.includes(item.id) &&
                    !pinned.includes(item.id),
                )?.label
              }
              className="nav-group"
            >
              {navItems
                .filter(
                  (item) =>
                    item.group === group &&
                    !primaryIds.includes(item.id) &&
                    !pinned.includes(item.id),
                )
                .map((item) => navigationItem(item, true))}
            </Disclosure>
          ))}
          <button
            className={cn('nav-item', activeView === 'search' && 'active')}
            onClick={() => setView('search')}
          >
            <Search size={15} />
            <span>全文搜索</span>
            <span className="count" title="Ctrl+Shift+F">
              Ctrl⇧F
            </span>
          </button>
        </div>
      </div>
    </nav>
  )
}
