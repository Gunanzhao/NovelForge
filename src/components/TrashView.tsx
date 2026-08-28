import { useEffect } from 'react'
import { ArchiveRestore, ShieldAlert, Trash2 } from 'lucide-react'
import { formatDate } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import { Button, Panel } from './ui'

export function TrashView() {
  const trash = useAppStore((state) => state.trash)
  const loadTrash = useAppStore((state) => state.loadTrash)
  const restoreTrash = useAppStore((state) => state.restoreTrash)
  const permanentlyDelete = useAppStore((state) => state.permanentlyDelete)
  useEffect(() => { void loadTrash() }, [loadTrash])
  return <div className="trash-view"><div className="view-header" style={{ padding: 0, marginBottom: 18 }}><div><p className="eyebrow">SAFE DELETE / TRASH</p><h1>回收站</h1><p>删除内容先移动到项目的 trash/ 目录。恢复前会检查原位置是否被占用。</p></div></div>{trash.length ? <div className="trash-list">{trash.map((item) => <Panel className="trash-item" key={item.id}><div><strong>{item.title}</strong><small>{item.refKind === 'node' ? '正文结构' : '资料条目'} · 删除于 {formatDate(item.deletedAt)}</small></div><div className="trash-actions"><Button variant="outline" onClick={() => void restoreTrash(item.id)}><ArchiveRestore size={14} />恢复</Button><Button variant="danger" onClick={() => { if (window.confirm('永久删除“' + item.title + '”？此操作无法撤销。')) void permanentlyDelete(item.id) }}><Trash2 size={14} />永久删除</Button></div></Panel>)}</div> : <div className="empty-state" style={{ minHeight: 360 }}><ShieldAlert size={27} /><div><strong>回收站是空的</strong><span>章节、人物和地点被删除后会先出现在这里，而不是立即消失。</span></div></div>}</div>
}
