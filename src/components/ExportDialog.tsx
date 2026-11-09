import { Disclosure } from './Disclosure'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Clipboard, FileArchive, FileDown, FileText, FolderOpen, Square } from 'lucide-react'
import type { ExportFormat, ExportInput, ProjectData } from '../lib/types'
import { isDesktop, projectApi } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { sortChapterNodes } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Modal, TextInput } from './ui'
import './export-dialog.css'

const formats: Array<{ id: ExportFormat; label: string; description: string; icon: typeof FileDown }> = [
  { id: 'markdown', label: 'Markdown', description: '保留标题层级和 Markdown 语法，适合继续编辑。', icon: FileText },
  { id: 'txt', label: '纯文本 TXT', description: '去掉 Markdown 标记，只保留纯文本内容。', icon: FileText },
  { id: 'html', label: '网页 HTML', description: '生成可在浏览器打开的单文件网页。', icon: FileArchive },
  { id: 'docx', label: 'Word DOCX', description: '适合在 Word 或 WPS 里继续编辑。', icon: FileDown },
  { id: 'epub', label: '电子书 EPUB', description: '生成带目录的 EPUB 电子书包。', icon: FileArchive },
  { id: 'pdf', label: 'PDF', description: '按文本分页，适合阅读和打印。', icon: FileDown },
]

const formatNotes: Partial<Record<ExportFormat, string>> = {
  txt: 'TXT 仅输出纯文本，没有目录或封面。',
  docx: 'DOCX 的正文图片会用替代文字显示；封面可单独插入。',
  epub: '电子书阅读器的导航目录始终保留；下方的选项仅控制正文目录。',
  pdf: 'PDF 不生成目录。正文按纯文本分页，不保留正文图片及完整的 Markdown 排版。',
}

function displayPath(path: string) {
  return path.replace(/^\\\\\?\\UNC\\/iu, '\\\\').replace(/^\\\\\?\\/u, '')
}

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
  onExport: (format: ExportFormat, options: ExportOptions) => Promise<string | void>
  data: ProjectData
  currentNodeId?: string
  preset?: ExportDialogPreset
}) {
  const projectPath = useAppStore(state => state.projectPath)
  const projectSession = useAppStore(state => state.projectSession)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const inFlight = useRef(false)
  const [result, setResult] = useState<{ path: string; session: number } | null>(null)
  const output = result?.session === projectSession ? result.path : null
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown')
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
  const supportsToc = selectedFormat !== 'txt' && selectedFormat !== 'pdf'
  const supportsCover = selectedFormat !== 'txt' && selectedFormat !== 'markdown' && scope !== 'chapters'

  const initialized = useRef<string | null>(null)
  const sessionKey = JSON.stringify([data.project.id, preset?.scope, preset?.volumePath, preset?.nodeIds])
  useEffect(() => {
    if (!open) { initialized.current = null; return }
    if (initialized.current === sessionKey) {
      setSelectedChapterIds(current => new Set([...current].filter(id => chapters.some(chapter => chapter.id === id))))
      setVolumePath(current => volumes.some(volume => volume.filePath === current) ? current : volumes[0]?.filePath ?? '')
      return
    }
    initialized.current = sessionKey
    setResult(null)
    setError('')
    setCopied(false)
    setSelectedFormat('markdown')
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
  }, [chapters, currentNodeId, data.project.author, data.project.title, open, preset, sessionKey, volumes])

  function toggleChapter(id: string) {
    setSelectedChapterIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function exportFormat(format: ExportFormat) {
    if (inFlight.current) return
    if (scope === 'volume' && !volumePath) return
    if (scope === 'chapters' && !selectedChapterIds.size) return
    inFlight.current = true
    setBusy(format)
    setError('')
    setCopied(false)
    try {
      const path = await onExport(format, {
        scope,
        volumePath: scope === 'volume' ? volumePath : undefined,
        nodeIds: scope === 'chapters' ? [...selectedChapterIds] : undefined,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        includeToc: supportsToc && includeToc,
        includeVolumeTitles: scope === 'chapters' ? undefined : includeVolumeTitles,
        includeChapterTitles,
        coverPath: supportsCover ? coverPath.trim() || undefined : undefined,
      })
      if (initialized.current !== sessionKey) return
      if (path) setResult({ path, session: projectSession })
      onClose()
    } catch (e) {
      if (initialized.current === sessionKey) setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function openOutput(folder: boolean) {
    if (!projectPath || !output) return
    setError('')
    try { await projectApi.openExportOutput(projectPath, output, folder) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const exportCount = scope === 'chapters' ? chapters.filter(chapter => selectedChapterIds.has(chapter.id)).length : scope === 'volume' ? chapters.filter(chapter => chapter.parentId === volumes.find(volume => volume.filePath === volumePath)?.id).length : chapters.length
  const formatLabel = formats.find(format => format.id === selectedFormat)?.label
  return <>
  <Modal open={open} title="导出项目" className="export-dialog" onClose={() => { if (!busy) onClose() }} footer={<>
    <div className="export-summary" aria-live="polite"><strong>{formatLabel} · {exportCount} 章</strong><small>{scope === 'project' ? '整本小说' : scope === 'volume' ? '指定卷' : '已选章节'}</small></div><Button variant="outline" disabled={Boolean(busy)} onClick={onClose}>取消</Button><Button disabled={Boolean(busy) || exportCount === 0} onClick={() => void exportFormat(selectedFormat)}>{busy ? '导出中…' : '导出 ' + formatLabel}</Button>
  </>}>
    {error && <p className="export-error" role="alert">{error}</p>}
    <fieldset className="export-fields" disabled={Boolean(busy)}>
    <div className="export-dialog-copy">选择范围和格式，文件会保存到项目的导出文件夹。</div>
    <div className="export-options">{formats.map(({ id, label, description, icon: Icon }) => <button type="button" key={id} className={'export-option' + (selectedFormat === id ? ' active' : '')} aria-pressed={selectedFormat === id} disabled={Boolean(busy)} onClick={() => setSelectedFormat(id)}><span className="export-option-icon"><Icon size={16} /></span><span><strong>{busy === id ? '导出中…' : label}</strong><small>{description}</small></span></button>)}</div>
    {formatNotes[selectedFormat] && <p className="export-format-note" role="status">{formatNotes[selectedFormat]}</p>}
    <div className="export-config-grid">
      <Field label="导出范围"><select className="select-input" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="project">整本小说</option><option value="volume">指定卷</option><option value="chapters">指定章节</option></select></Field>
      {scope === 'volume' ? <Field label="选择卷"><select className="select-input" value={volumePath} onChange={(event) => setVolumePath(event.target.value)}>{volumes.map((volume) => <option key={volume.id} value={volume.filePath}>{volume.title}</option>)}</select></Field> : null}
    </div>
    {scope === 'chapters' ? <div className="export-chapter-picker"><div className="field-label">选择章节</div><div className="export-chapter-list">{chapters.map((chapter) => <button type="button" key={chapter.id} className="export-chapter-option" onClick={() => toggleChapter(chapter.id)}>{selectedChapterIds.has(chapter.id) ? <CheckSquare size={14} /> : <Square size={14} />}<span>{chapter.title}</span></button>)}</div><span className="field-hint">已选择 {selectedChapterIds.size} 章</span></div> : null}

    <Disclosure title="版式选项" className="export-advanced"><div className="export-config-grid"><Field label="作品名"><TextInput value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="作者"><TextInput value={author} onChange={(event) => setAuthor(event.target.value)} /></Field></div>
    <div className="export-checks">
      {supportsToc && <label><input type="checkbox" checked={includeToc} onChange={(event) => setIncludeToc(event.target.checked)} />{selectedFormat === 'epub' ? '在正文插入目录' : '包含目录'}</label>}
      {scope !== 'chapters' && <label><input type="checkbox" checked={includeVolumeTitles} onChange={(event) => setIncludeVolumeTitles(event.target.checked)} />包含卷标题</label>}
      <label><input type="checkbox" checked={includeChapterTitles} onChange={(event) => setIncludeChapterTitles(event.target.checked)} />包含章节标题</label>
    </div>
    {supportsCover && <Field label="封面相对路径" hint="可选；填写项目内图片路径，例如 attachments/cover.jpg"><TextInput value={coverPath} onChange={(event) => setCoverPath(event.target.value)} placeholder="attachments/cover.jpg" /></Field>}
    </Disclosure>
    </fieldset>
  </Modal>
  {!open && output && <section className="export-output" aria-label="导出结果">
    <div className="export-output-heading"><strong role="status">导出完成</strong><Button variant="ghost" onClick={() => setResult(null)}>关闭导出结果</Button></div>
    <p>{isDesktop ? '导出文件已保存：' : '文件已交给浏览器下载。'}</p>
    {isDesktop && <>
      <code>{displayPath(output)}</code>
      <div className="export-output-actions">
        <Button variant="outline" onClick={() => void openOutput(false)}><FileText size={14} />打开文件</Button>
        <Button variant="outline" onClick={() => void openOutput(true)}><FolderOpen size={14} />打开所在文件夹</Button>
        <Button variant="ghost" onClick={() => void writeClipboardText(displayPath(output)).then(ok => { setCopied(ok); setError(ok ? '' : '复制失败，请手动复制路径。') })}><Clipboard size={14} />复制路径</Button>
        {copied && <span className="field-hint" role="status">已复制</span>}
      </div>
    </>}
    {error && <p className="export-error" role="alert">{error}</p>}
  </section>}
  </>
}
