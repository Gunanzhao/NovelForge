import { useEffect, useMemo, useState } from 'react'
import { CheckSquare, FileArchive, FileDown, FileText, Square } from 'lucide-react'
import type { ExportFormat, ExportInput, ProjectData } from '../lib/types'
import { sortChapterNodes } from '../lib/planning-data'
import { Button, Field, Modal, TextInput } from './ui'

const formats: Array<{ id: ExportFormat; label: string; description: string; icon: typeof FileDown }> = [
  { id: 'markdown', label: 'Markdown', description: '保留标题层级和 Markdown 语法，适合继续编辑。', icon: FileText },
  { id: 'txt', label: '纯文本 TXT', description: '去掉 Markdown 标记，只保留纯文本内容。', icon: FileText },
  { id: 'html', label: '网页 HTML', description: '生成可在浏览器打开的单文件网页。', icon: FileArchive },
  { id: 'docx', label: 'Word DOCX', description: '生成可在 Word/WPS 中打开的文档。', icon: FileDown },
  { id: 'epub', label: '电子书 EPUB', description: '生成带目录的 EPUB 电子书包。', icon: FileArchive },
  { id: 'pdf', label: 'PDF', description: '生成适合归档和打印的 PDF 文件。', icon: FileDown },
]

type ExportOptions = Omit<ExportInput, 'projectPath' | 'format'>

export interface ExportDialogPreset {
  scope: 'project' | 'volume' | 'chapters'
  volumePath?: string
  nodeIds?: string[]
}

export function ExportDialog({
  open, onClose, onExport, data, currentNodeId, preset,
}: {
  open: boolean
  onClose: () => void
  onExport: (format: ExportFormat, options: ExportOptions) => Promise<void>
  data: ProjectData
  currentNodeId?: string
  preset?: ExportDialogPreset
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [scope, setScope] = useState<'project' | 'volume' | 'chapters'>('project')
  const [volumePath, setVolumePath] = useState('')
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState(data.project.title)
  const [author, setAuthor] = useState(data.project.author)
  const [includeToc, setIncludeToc] = useState(true)
  const [includeVolumeTitles, setIncludeVolumeTitles] = useState(true)
  const [includeChapterTitles, setIncludeChapterTitles] = useState(true)
  const [coverPath, setCoverPath] = useState('')
  const volumes = useMemo(() => data.nodes.filter((node) => node.kind === 'volume').sort((left, right) => left.orderIndex - right.orderIndex), [data.nodes])
  const chapters = useMemo(() => sortChapterNodes(data.nodes), [data.nodes])

  useEffect(() => {
    if (!open) return
    setScope(preset?.scope ?? 'project')
    setVolumePath(preset?.volumePath ?? volumes[0]?.filePath ?? '')
    const presetIds = preset?.nodeIds?.filter((id) => chapters.some((chapter) => chapter.id === id)) ?? []
    setSelectedChapterIds(presetIds.length ? new Set(presetIds) : currentNodeId && chapters.some((chapter) => chapter.id === currentNodeId) ? new Set([currentNodeId]) : new Set())
    setTitle(data.project.title)
    setAuthor(data.project.author)
    setIncludeToc(true)
    setIncludeVolumeTitles(true)
    setIncludeChapterTitles(true)
    setCoverPath('')
  }, [chapters, currentNodeId, data.project.author, data.project.title, open, preset, volumes])

  function toggleChapter(id: string) {
    setSelectedChapterIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function exportFormat(format: ExportFormat) {
    if (scope === 'volume' && !volumePath) return
    if (scope === 'chapters' && !selectedChapterIds.size) return
    setBusy(format)
    try {
      await onExport(format, {
        scope,
        volumePath: scope === 'volume' ? volumePath : undefined,
        nodeIds: scope === 'chapters' ? [...selectedChapterIds] : undefined,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        includeToc,
        includeVolumeTitles,
        includeChapterTitles,
        coverPath: coverPath.trim() || undefined,
      })
      onClose()
    } finally {
      setBusy(null)
    }
  }

  return <Modal open={open} title="导出项目" onClose={() => { if (!busy) onClose() }} footer={<Button variant="outline" disabled={Boolean(busy)} onClick={onClose}>取消</Button>}>
    <div className="export-dialog-copy">选择导出范围与格式。导出文件会写入项目 .novelforge/exports/，不会修改正文。</div>
    <div className="export-config-grid">
      <Field label="导出范围"><select className="select-input" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="project">整本小说</option><option value="volume">指定卷</option><option value="chapters">指定章节</option></select></Field>
      {scope === 'volume' ? <Field label="选择卷"><select className="select-input" value={volumePath} onChange={(event) => setVolumePath(event.target.value)}>{volumes.map((volume) => <option key={volume.id} value={volume.filePath}>{volume.title}</option>)}</select></Field> : null}
    </div>
    {scope === 'chapters' ? <div className="export-chapter-picker"><div className="field-label">选择章节</div><div className="export-chapter-list">{chapters.map((chapter) => <button type="button" key={chapter.id} className="export-chapter-option" onClick={() => toggleChapter(chapter.id)}>{selectedChapterIds.has(chapter.id) ? <CheckSquare size={14} /> : <Square size={14} />}<span>{chapter.title}</span></button>)}</div><span className="field-hint">已选择 {selectedChapterIds.size} 章</span></div> : null}
    <div className="export-config-grid"><Field label="作品名"><TextInput value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="作者"><TextInput value={author} onChange={(event) => setAuthor(event.target.value)} /></Field></div>
    <div className="export-checks"><label><input type="checkbox" checked={includeToc} onChange={(event) => setIncludeToc(event.target.checked)} />包含目录</label><label><input type="checkbox" checked={includeVolumeTitles} onChange={(event) => setIncludeVolumeTitles(event.target.checked)} />包含卷标题</label><label><input type="checkbox" checked={includeChapterTitles} onChange={(event) => setIncludeChapterTitles(event.target.checked)} />包含章节标题</label></div>
    {scope === 'project' || scope === 'volume' ? <Field label="封面相对路径" hint="可选；填写项目内图片路径，例如 attachments/cover.jpg"><TextInput value={coverPath} onChange={(event) => setCoverPath(event.target.value)} placeholder="attachments/cover.jpg" /></Field> : null}
    <div className="export-options">{formats.map(({ id, label, description, icon: Icon }) => <button type="button" key={id} className="export-option" disabled={Boolean(busy)} onClick={() => void exportFormat(id)}><span className="export-option-icon"><Icon size={16} /></span><span><strong>{busy === id ? '导出中…' : label}</strong><small>{description}</small></span></button>)}</div>
  </Modal>
}
