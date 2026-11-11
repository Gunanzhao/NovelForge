import { Disclosure } from './Disclosure'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Clipboard, FileArchive, FileDown, FileText, FolderOpen, Square } from 'lucide-react'
import type { ExportFormat, ExportInput, ExportIssueReason, ExportPreflight, ProjectData } from '../lib/types'
import { isDesktop, projectApi } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { sortChapterNodes } from '../lib/planning-data'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
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

const preflightLabels: Record<ExportIssueReason, string> = {
  notFinal: '未定稿',
  empty: '空正文',
  sample: '疑似新建示例',
  unreadable: '无法读取',
}

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
  const saveState = useAppStore(state => state.saveState)
  const saved = useAppStore(state => !state.document || (state.saveState === 'saved' && state.document.content === state.document.persistedContent))
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
  const [onlyFinal, setOnlyFinal] = useState(false)
  const [includeSections, setIncludeSections] = useState(true)
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
      setSelectedChapterIds(current => {
        const ids = [...current].filter(id => chapters.some(chapter => chapter.id === id))
        return ids.length === current.size ? current : new Set(ids)
      })
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
    setOnlyFinal(false)
    setIncludeSections(true)
    setCoverPath('')
  }, [chapters, currentNodeId, data.project.author, data.project.title, open, preset, sessionKey, volumes])

  const scoped = useMemo(() => {
    const volumeId = volumes.find(volume => volume.filePath === volumePath)?.id
    const list = chapters.filter(chapter => scope === 'project' || (scope === 'volume' ? chapter.parentId === volumeId : selectedChapterIds.has(chapter.id)))
    const ids = new Set(list.map(chapter => chapter.id))
    return { chapters: list.length, sections: data.nodes.filter(node => node.kind === 'section' && node.parentId && ids.has(node.parentId)).length }
  }, [chapters, data.nodes, scope, selectedChapterIds, volumePath, volumes])
  const selection = useMemo(() => ({
    scope,
    volumePath: scope === 'volume' ? volumePath : undefined,
    nodeIds: scope === 'chapters' ? [...selectedChapterIds] : undefined,
    onlyFinal,
    includeSections,
  }), [includeSections, onlyFinal, scope, selectedChapterIds, volumePath])
  const [checkAttempt, setCheckAttempt] = useState(0)
  const request = useMemo(() => open && saved && projectPath && scoped.chapters
    ? { input: { projectPath, ...selection }, data, projectSession, checkAttempt } : null,
  [checkAttempt, data, open, projectPath, projectSession, saved, scoped.chapters, selection])
  const [checked, setChecked] = useState<{ request: typeof request; report?: ExportPreflight; error?: string } | null>(null)
  const preflight = request && checked?.request === request ? checked.report : undefined
  const preflightError = request && checked?.request === request ? checked.error : undefined
  useEffect(() => {
    if (!request) return
    let alive = true
    const timer = window.setTimeout(() => {
      void projectApi.exportPreflight(request.input).then(
        report => { if (alive) setChecked({ request, report }) },
        reason => { if (alive) setChecked({ request, error: reason instanceof Error ? reason.message : String(reason) }) },
      )
    }, 100)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [request])
  const exportCount = preflight?.chapters ?? scoped.chapters
  const sectionCount = preflight?.sections ?? (includeSections ? scoped.sections : 0)
  const hasUnreadable = preflight?.issues.some(issue => issue.reasons.includes('unreadable'))
  const canExport = (exportCount + sectionCount > 0) && (!projectPath || (saved && preflight && !hasUnreadable))

  function toggleChapter(id: string) {
    setSelectedChapterIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function exportFormat(format: ExportFormat) {
    if (inFlight.current || !canExport) return
    const session = captureProjectSession()
    const state = useAppStore.getState()
    if (projectPath && (session.path !== projectPath || session.generation !== projectSession || state.data !== request?.data ||
      (state.document && (state.saveState !== 'saved' || state.document.content !== state.document.persistedContent)))) return
    inFlight.current = true
    setBusy(format)
    setError('')
    setCopied(false)
    try {
      const path = await onExport(format, {
        ...selection,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        includeToc: supportsToc && includeToc,
        includeVolumeTitles: scope === 'chapters' ? undefined : includeVolumeTitles,
        includeChapterTitles,
        coverPath: supportsCover ? coverPath.trim() || undefined : undefined,
      })
      if (initialized.current !== sessionKey || !isCurrentProjectSession(session)) return
      if (path) setResult({ path, session: projectSession })
      onClose()
    } catch (e) {
      if (initialized.current === sessionKey && isCurrentProjectSession(session)) setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function saveForPreflight() {
    const session = captureProjectSession()
    const ok = await useAppStore.getState().saveCurrentDocument('导出预检前保存')
    if (isCurrentProjectSession(session)) setError(ok ? '' : '正文保存失败，请先在编辑器中处理后再导出。')
  }

  async function inspect(nodeId: string) {
    const session = captureProjectSession()
    await useAppStore.getState().selectNode(nodeId, true)
    const state = useAppStore.getState()
    if (isCurrentProjectSession(session) && state.activeView === 'manuscript' && state.document?.node.id === nodeId) onClose()
  }

  async function openOutput(folder: boolean) {
    if (!projectPath || !output) return
    setError('')
    try { await projectApi.openExportOutput(projectPath, output, folder) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const formatLabel = formats.find(format => format.id === selectedFormat)?.label
  return <>
  <Modal open={open} title="导出项目" className="export-dialog" onClose={() => { if (!busy) onClose() }} footer={<>
    <div className="export-summary" aria-live="polite"><strong>{formatLabel} · {exportCount} 章{sectionCount > 0 && ` · ${sectionCount} 小节`}</strong><small>{scope === 'project' ? '整本小说' : scope === 'volume' ? '指定卷' : '已选章节'}{preflight?.issues.length ? ` · ${preflight.issues.length} 项需检查` : ''}</small></div><Button variant="outline" disabled={Boolean(busy)} onClick={onClose}>取消</Button><Button disabled={Boolean(busy) || !canExport} onClick={() => void exportFormat(selectedFormat)}>{busy ? '导出中…' : '导出 ' + formatLabel}</Button>
  </>}>
    {error && <p className="export-error" role="alert">{error}</p>}
    <fieldset className="export-fields" disabled={Boolean(busy)}>
    <div className="export-dialog-copy">选择范围和格式，文件会保存到项目的导出文件夹。</div>
    <div className="export-config-grid">
      <Field label="导出范围"><select className="select-input" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="project">整本小说</option><option value="volume">指定卷</option><option value="chapters">指定章节</option></select></Field>
      {scope === 'volume' ? <Field label="选择卷"><select className="select-input" value={volumePath} onChange={(event) => setVolumePath(event.target.value)}>{volumes.map((volume) => <option key={volume.id} value={volume.filePath}>{volume.title}</option>)}</select></Field> : null}
    </div>
    {scope === 'chapters' ? <div className="export-chapter-picker"><div className="field-label">选择章节</div><div className="export-chapter-list">{chapters.map((chapter) => <button type="button" key={chapter.id} className="export-chapter-option" onClick={() => toggleChapter(chapter.id)}>{selectedChapterIds.has(chapter.id) ? <CheckSquare size={14} /> : <Square size={14} />}<span>{chapter.title}</span></button>)}</div><span className="field-hint">已选择 {selectedChapterIds.size} 章</span></div> : null}

    <section className="export-preflight" aria-label="交稿预检">
      <h3>交稿预检</h3>
      <div className="export-checks">
        <label><input type="checkbox" checked={onlyFinal} onChange={event => setOnlyFinal(event.target.checked)} />仅导出定稿章</label>
        {scoped.sections > 0 && <label><input type="checkbox" checked={includeSections} onChange={event => setIncludeSections(event.target.checked)} />包含小节</label>}
      </div>
      <p className="field-hint">定稿取自统一的写作阶段，可在正文、看板或「章节完成」中设置。{scoped.sections > 0 && '小节随所属章节导出，没有单独的定稿状态。'}</p>
      {!scoped.chapters ? <p className="field-hint">请选择有正文的导出范围。</p>
        : !saved ? <div className="export-preflight-save"><span>正文有待保存的改动，保存后会重新检查。</span><Button variant="outline" disabled={saveState === 'saving'} onClick={() => void saveForPreflight()}>保存正文并预检</Button></div>
        : preflightError ? <div><p className="export-error" role="alert">预检失败：{preflightError}</p><Button variant="outline" onClick={() => setCheckAttempt(attempt => attempt + 1)}>重试预检</Button></div>
        : preflight ? <>
          {(preflight.excludedChapters > 0 || preflight.excludedSections > 0) && <p className="field-hint">按当前选项排除 {preflight.excludedChapters} 章、{preflight.excludedSections} 小节。</p>}
          {exportCount + sectionCount === 0 ? <p role="status">所选范围没有定稿正文，可扩大范围或取消仅导出定稿章。</p>
            : preflight.issues.length ? <details className="export-preflight-issues">
              <summary>{Object.entries(preflightLabels).flatMap(([reason, label]) => {
                const count = preflight.issues.filter(issue => issue.reasons.includes(reason as ExportIssueReason)).length
                return count ? [`${label} ${count} 项`] : []
              }).join(' · ')}<small>查看清单</small></summary>
              <ul>{preflight.issues.map(issue => <li key={issue.nodeId}>
                <Button variant="ghost" onClick={() => void inspect(issue.nodeId)}>{issue.title}</Button>
                <span>{issue.kind === 'section' ? '小节 · ' : ''}{issue.reasons.map(reason => preflightLabels[reason]).join(' · ')}</span>
                {issue.detail && <small>{issue.detail}</small>}
              </li>)}</ul>
            </details> : <p role="status">所选正文通过预检。</p>}
          {hasUnreadable && <div className="export-preflight-save"><span role="alert">有正文无法读取，修复后才能导出。</span><Button variant="outline" onClick={() => setCheckAttempt(attempt => attempt + 1)}>重新预检</Button></div>}
        </> : projectPath ? <p role="status">正在检查所选正文…</p> : null}
    </section>
    <div className="export-options">{formats.map(({ id, label, description, icon: Icon }) => <button type="button" key={id} className={'export-option' + (selectedFormat === id ? ' active' : '')} aria-pressed={selectedFormat === id} disabled={Boolean(busy)} onClick={() => setSelectedFormat(id)}><span className="export-option-icon"><Icon size={16} /></span><span><strong>{busy === id ? '导出中…' : label}</strong><small>{description}</small></span></button>)}</div>
    {formatNotes[selectedFormat] && <p className="export-format-note" role="status">{formatNotes[selectedFormat]}</p>}
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
