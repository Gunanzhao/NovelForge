import { useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { ArchiveRestore, ShieldAlert, Trash2 } from 'lucide-react'
import { formatDate } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { Button, Panel } from './ui'
import { useContextMenu } from './ContextMenu'

export function TrashView() {
  const trash = useAppStore((state) => state.trash)
  const loadTrash = useAppStore((state) => state.loadTrash)
  const restoreTrash = useAppStore((state) => state.restoreTrash)
  const permanentlyDelete = useAppStore((state) => state.permanentlyDelete)
  const emptyTrash = useAppStore((state) => state.emptyTrash)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  useEffect(() => { void loadTrash() }, [loadTrash])
  function openTrashMenu(event: ReactMouseEvent<HTMLDivElement>, item: typeof trash[number]) {
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'trash-restore', label: '恢复', icon: ArchiveRestore, onSelect: () => void restoreTrash(item.id) },
      { type: 'item', id: 'trash-copy-path', label: '复制原始路径', onSelect: async () => { if (!await writeClipboardText(item.originalPath)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'separator' },
      { type: 'item', id: 'trash-delete', label: '永久删除', icon: Trash2, tone: 'danger', onSelect: () => { if (window.confirm('永久删除“' + item.title + '”？此操作无法撤销。')) void permanentlyDelete(item.id) } },
    ]
    openContextMenu(event, { title: item.title, location: 'trash', payload: { location: 'trash', trashId: item.id }, items, trigger: event.currentTarget })
  }
  return <div className="trash-view"><div className="view-header" style={{ padding: 0, marginBottom: 18 }}><div><p className="eyebrow">SAFE DELETE / TRASH</p><h1>回收站</h1><p>删除内容先移动到项目的 trash/ 目录。恢复前会检查原位置是否被占用。</p></div>{trash.length ? <Button variant="danger" onClick={() => { if (window.confirm('清空回收站？所有项目将永久删除，无法恢复。')) void emptyTrash() }}><Trash2 size={14} />清空回收站</Button> : null}</div>{trash.length ? <div className="trash-list">{trash.map((item) => <Panel className="trash-item" key={item.id} onContextMenu={(event) => openTrashMenu(event, item)}><div><strong>{item.title}</strong><small>{item.refKind === 'node' ? '正文结构' : '资料条目'} · 删除于 {formatDate(item.deletedAt)}</small></div><div className="trash-actions"><Button variant="outline" onClick={() => void restoreTrash(item.id)}><ArchiveRestore size={14} />恢复</Button><Button variant="danger" onClick={() => { if (window.confirm('永久删除“' + item.title + '”？此操作无法撤销。')) void permanentlyDelete(item.id) }}><Trash2 size={14} />永久删除</Button></div></Panel>)}</div> : <div className="empty-state" style={{ minHeight: 360 }}><ShieldAlert size={27} /><div><strong>回收站是空的</strong><span>章节、人物和地点被删除后会先出现在这里，而不是立即消失。</span></div></div>}</div>
}
