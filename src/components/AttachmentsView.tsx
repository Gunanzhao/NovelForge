import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Clipboard, ExternalLink, FileArchive, FileText, Image, Paperclip, Plus, Save, Trash2 } from 'lucide-react'
import { chooseFile, isDesktop, projectApi } from '../lib/api'
import { contentText, sortChapterNodes } from '../lib/planning-data'
import type { EntityRecord } from '../lib/types'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'

function bytes(value: string) {
  const size = Number(value)
  if (!Number.isFinite(size) || size < 0) return '未知大小'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return Image
  if (mime === 'application/pdf' || mime.includes('word') || mime.startsWith('text/')) return FileText
  return FileArchive
}

function metadata(entity: EntityRecord | undefined) {
  return {
    originalName: contentText(entity, 'originalName', entity?.title ?? ''),
    mimeType: contentText(entity, 'mimeType', 'application/octet-stream'),
    sizeBytes: contentText(entity, 'sizeBytes'),
    description: contentText(entity, 'description'),
    chapterId: contentText(entity, 'chapterId'),
  }
}

export function AttachmentsView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const setError = useAppStore((state) => state.setError)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [description, setDescription] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [busy, setBusy] = useState(false)

  const attachments = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'attachment').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [data?.entities])
  const visible = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return query ? attachments.filter((attachment) => [attachment.title, attachment.filePath, ...attachment.tags, contentText(attachment, 'description')].join(' ').toLocaleLowerCase().includes(query)) : attachments
  }, [attachments, filter])
  const selected = attachments.find((attachment) => attachment.id === selectedId)
  const chapters = useMemo(() => sortChapterNodes(data?.nodes ?? []), [data?.nodes])

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(attachments[0]?.id ?? null)
    if (!selectedId && attachments.length) setSelectedId(attachments[0].id)
  }, [attachments, selected, selectedId])

  useEffect(() => { setDescription(metadata(selected).description); setChapterId(metadata(selected).chapterId) }, [selected])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  async function importFile() {
    const sourcePath = await chooseFile()
    if (!sourcePath) {
      if (!isDesktop) setError('附件导入需要在桌面版中选择本机文件。')
      return
    }
    setBusy(true)
    try {
      const result = await projectApi.importAttachment({ projectPath: currentProjectPath, sourcePath, description: '' })
      const importedName = sourcePath.split(/[\\/]/u).pop() ?? sourcePath
      const imported = result.entities.filter((entity) => entity.kind === 'attachment' && entity.title === importedName).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      await useAppStore.getState().refreshData(result, true)
      setSelectedId(imported?.id ?? null)
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function saveDescription() {
    if (!selected) return
    setBusy(true)
    try {
      const details = metadata(selected)
      await saveEntity({
        projectPath: currentProjectPath, kind: 'attachment', id: selected.id, title: selected.title,
        content: { originalName: details.originalName, mimeType: details.mimeType, sizeBytes: Number(details.sizeBytes) || 0, description, chapterId }, tags: ['附件'],
      })
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function openSelected() {
    if (!selected) return
    setBusy(true)
    try { await projectApi.openAttachment({ projectPath: currentProjectPath, nodeId: selected.id }) }
    catch (error) { setError(error) }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!selected || !window.confirm(`将“${selected.title}”移入回收站？`)) return
    try {
      await deleteEntity(selected.id)
      setSelectedId(null)
    } catch (error) {
      setError(error)
    }
  }

  function copyPath() {
    if (selected) void navigator.clipboard?.writeText(selected.filePath)
  }

  return <div className="workspace-view attachments-view"><div className="view-header"><div><p className="eyebrow">RESEARCH ATTACHMENTS</p><h1>资料附件</h1><p>把参考文档、图片和素材复制进项目目录，随项目一起备份；原始文件不会被修改。</p></div><div className="special-summary"><strong>{attachments.length}</strong><span>个附件</span></div></div><div className="attachments-toolbar"><TextInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索附件名称或说明" /><Button onClick={() => void importFile()} disabled={busy}><Plus size={14} />{busy ? '导入中…' : '导入附件'}</Button></div><div className="attachments-layout"><aside className="attachments-list-pane"><div className="special-list">{visible.length ? visible.map((attachment) => { const details = metadata(attachment); const Icon = fileIcon(details.mimeType); return <button type="button" key={attachment.id} className={'attachment-list-item' + (attachment.id === selectedId ? ' active' : '')} onClick={() => setSelectedId(attachment.id)}><span className="attachment-icon"><Icon size={16} /></span><span><strong>{attachment.title}</strong><small>{bytes(details.sizeBytes)} · {details.mimeType}</small></span></button> }) : <div className="empty-state"><Paperclip size={25} /><div><strong>{filter ? '没有匹配附件' : '还没有附件'}</strong><span>{filter ? '换一个关键词试试。' : '导入研究资料、图片或参考文档。'}</span></div></div>}</div></aside><section className="special-editor"><Panel className="special-card">{selected ? <><div className="planning-card-head"><div><p className="eyebrow">ATTACHMENT DETAIL</p><h3>{selected.title}</h3></div><span className="planning-state">项目内副本</span></div><div className="planning-form"><div className="attachment-meta-grid"><div><span>文件类型</span><strong>{metadata(selected).mimeType}</strong></div><div><span>大小</span><strong>{bytes(metadata(selected).sizeBytes)}</strong></div></div><Field label="项目路径"><div className="input-with-action"><TextInput readOnly value={selected.filePath} /><Button variant="outline" onClick={copyPath}><Clipboard size={13} />复制</Button></div></Field><Field label="关联章节"><select className="select-input" value={chapterId} onChange={(event) => setChapterId(event.target.value)}><option value="">不关联章节</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>{chapterId ? <span className="field-hint"><BookOpen size={11} />附件会显示在对应章节的资料上下文中。</span> : null}</Field><Field label="资料说明"><textarea className="text-area" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="记录这份素材和小说的关系…" /></Field><div className="entity-actions"><Button variant="outline" onClick={() => void openSelected()} disabled={busy}><ExternalLink size={14} />打开文件</Button><Button onClick={() => void saveDescription()} disabled={busy}><Save size={14} />保存说明</Button><Button variant="danger" onClick={() => void remove()} disabled={busy}><Trash2 size={14} />移入回收站</Button></div></div></> : <div className="empty-state"><Paperclip size={25} /><div><strong>选择一个附件</strong><span>从左侧选择附件，或点击“导入附件”开始。</span></div></div>}</Panel></section></div></div>
}
