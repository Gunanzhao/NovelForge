import { useCallback, useEffect, useMemo, useState } from 'react'
import { Command, Keyboard, RotateCcw, Search, X } from 'lucide-react'
import {
  COMMANDS, commandView, defaultShortcutMap, readShortcutMap, shortcutFromKeyboardEvent,
  writeShortcutMap,
} from '../lib/command-registry'
import type { CommandId, CommandDescriptor, ShortcutMap } from '../lib/command-registry'
import { useAppStore } from '../stores/app-store'
import { Button, IconButton, TextInput } from './ui'

interface CommandPaletteProps {
  onNewProject: () => void
  onCloseProject: () => void
  onQuickOpen: () => void
}

interface RegisteredCommand extends CommandDescriptor {
  run: () => void
}

export function CommandPalette({ onNewProject, onCloseProject, onQuickOpen }: CommandPaletteProps) {
  const setView = useAppStore((state) => state.setView)
  const saveCurrentDocument = useAppStore((state) => state.saveCurrentDocument)
  const toggleFocusMode = useAppStore((state) => state.toggleFocusMode)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recording, setRecording] = useState<CommandId | null>(null)
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => readShortcutMap())
  const [notice, setNotice] = useState('')

  const runCommand = useCallback((id: CommandId) => {
    if (id === 'open-palette') {
      setOpen((current) => !current)
      return
    }
    const view = commandView(id)
    if (view) {
      setView(view)
      if (id === 'open-search' || id === 'open-full-search') {
        window.dispatchEvent(new CustomEvent('novelforge:search-scope', { detail: id === 'open-search' ? 'current' : 'project' }))
      }
    } else if (id === 'new-project') {
      onNewProject()
    } else if (id === 'close-project') {
      onCloseProject()
    } else if (id === 'quick-open') {
      onQuickOpen()
    } else if (id === 'save-document') {
      void saveCurrentDocument('命令面板保存')
    } else if (id === 'toggle-focus') {
      toggleFocusMode()
    }
    setOpen(false)
    setRecording(null)
  }, [onCloseProject, onNewProject, onQuickOpen, saveCurrentDocument, setView, toggleFocusMode])

  const commands = useMemo<RegisteredCommand[]>(() => COMMANDS.map((command) => ({ ...command, run: () => runCommand(command.id) })), [runCommand])
  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return commands
    return commands.filter((command) => [command.label, command.description, ...command.keywords].join(' ').toLocaleLowerCase().includes(normalized))
  }, [commands, query])

  useEffect(() => {
    writeShortcutMap(shortcuts)
  }, [shortcuts])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setNotice('')
  }, [open])

  useEffect(() => {
    if (activeIndex >= visibleCommands.length) setActiveIndex(Math.max(0, visibleCommands.length - 1))
  }, [activeIndex, visibleCommands.length])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (recording) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setRecording(null)
          setNotice('已取消快捷键设置')
          return
        }
        const shortcut = shortcutFromKeyboardEvent(event)
        if (!shortcut) return
        event.preventDefault()
        const conflict = Object.entries(shortcuts).find(([id, value]) => id !== recording && value === shortcut)
        if (conflict) {
          const command = COMMANDS.find((item) => item.id === conflict[0])
          setNotice(`快捷键 ${shortcut} 已被“${command?.label ?? conflict[0]}”使用，请换一个组合键。`)
          return
        }
        setShortcuts((current) => ({ ...current, [recording]: shortcut }))
        setRecording(null)
        setNotice(`已设置为 ${shortcut}`)
        return
      }

      if (event.key === 'Escape' && open) {
        event.preventDefault()
        setOpen(false)
        return
      }
      const shortcut = shortcutFromKeyboardEvent(event)
      if (shortcut && (shortcut === shortcuts['open-palette'] || (shortcut === 'Ctrl+K' && shortcuts['open-palette'] === 'Ctrl+Shift+P'))) {
        event.preventDefault()
        setOpen((current) => !current)
        return
      }
      if (open) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActiveIndex((current) => visibleCommands.length ? (current + 1) % visibleCommands.length : 0)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActiveIndex((current) => visibleCommands.length ? (current - 1 + visibleCommands.length) % visibleCommands.length : 0)
        } else if (event.key === 'Enter' && visibleCommands[activeIndex]) {
          event.preventDefault()
          visibleCommands[activeIndex].run()
        }
        return
      }
      const command = Object.entries(shortcuts).find(([, value]) => value && value === shortcut)
      if (command) {
        event.preventDefault()
        runCommand(command[0] as CommandId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, open, recording, runCommand, shortcuts, visibleCommands])

  if (!open) return null

  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !recording) setOpen(false) }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div className="command-palette-head"><div className="command-search"><Search size={16} /><TextInput autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} placeholder="输入命令、功能或关键词…" aria-label="搜索命令" /></div><IconButton icon={X} label="关闭命令面板" onClick={() => setOpen(false)} /></div>
      <div className="command-list" role="listbox" aria-label="可用命令">{visibleCommands.length ? visibleCommands.map((command, index) => <div className={'command-row' + (index === activeIndex ? ' active' : '')} key={command.id}><button type="button" className="command-main" role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={command.run}><span className="command-icon"><Command size={14} /></span><span className="command-copy"><strong>{command.label}</strong><small>{command.description}</small></span></button><button type="button" className={'command-shortcut' + (recording === command.id ? ' recording' : '')} onClick={() => { setRecording(command.id); setNotice('请按下新的快捷键组合，Esc 取消') }} title="点击设置快捷键">{recording === command.id ? '按键中…' : shortcuts[command.id] || '未设置'}</button></div>) : <div className="command-empty">没有匹配的命令</div>}</div>
      <div className="command-palette-foot"><span><Keyboard size={13} />↑↓选择 · Enter 执行 · 点击右侧设置快捷键</span><Button variant="ghost" onClick={() => { setShortcuts(defaultShortcutMap()); setNotice('已恢复默认快捷键') }}><RotateCcw size={12} />恢复默认</Button></div>
      {notice ? <p className="command-notice">{notice}</p> : null}
    </div>
  </div>
}
