import { protectBeforeChange, historyChanged } from '../lib/history'
import { Disclosure } from './Disclosure'
import { linkedAttachments } from '../lib/attachment-data'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, ChevronUp, Clipboard, GitCompare, History, Lightbulb, RotateCcw } from 'lucide-react'
import { projectApi } from '../lib/api'
import { cleanWritingWhitespace, convertFullwidth, convertHalfwidth, convertPunctuation, indentParagraphs, wikiTargets, writingHints } from '../lib/markdown'
import { diffLines } from '../lib/text-diff'
import { NODE_STATUS_LABELS } from '../lib/types'
import { countWords, formatDate, formatNumber } from '../lib/utils'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { Button, Modal, Field, TextInput } from './ui'
import { NameGenerator } from './NameGenerator'
import { MentionInspector } from './MentionInspector'
import { StoryArcInspector } from './StoryArcInspector'
import { ChapterChecklistInspector } from './ChapterWorkflow'
import { useContextMenu } from './ContextMenu'

export function Inspector() {
  const identity = useAppStore(state => JSON.stringify([state.projectPath, state.projectSession, state.document?.node.id]))
  return <InspectorContent key={identity} />
}

function InspectorContent() {
  const document = useAppStore((state) => state.document)
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const updateContent = useAppStore((state) => state.updateContent)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const setView = useAppStore((state) => state.setView)
  const refreshData = useAppStore((state) => state.refreshData)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [historyLimit, setHistoryLimit] = useState(100)
  const [versionDialog, setVersionDialog] = useState(false)
  const [versionName, setVersionName] = useState('')
  const [versionSaving, setVersionSaving] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')
  useEffect(() => {
    const refresh = () => setHistoryRefresh(value => value + 1)
    window.addEventListener('novelforge:history-changed', refresh)
    return () => window.removeEventListener('novelforge:history-changed', refresh)
  }, [])
  const [history, setHistory] = useState<Awaited<ReturnType<typeof projectApi.listHistory>>>([])
  const [historyPreview, setHistoryPreview] = useState<{ id: string; content: string; mode: 'view' | 'diff' } | null>(null)
  const mounted = useRef(true)
  const previewRequest = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const session = captureProjectSession()
  const isCurrent = () => mounted.current && isCurrentProjectSession(session) && useAppStore.getState().document?.node.id === document?.node.id

  useEffect(() => {
    let active = true
    if (!projectPath || !document) { setHistory([]); return }
    void projectApi.listHistory({ projectPath, nodeId: document.node.id }).then(items => { if (active) setHistory(items.filter(item => item.nodeId === document.node.id)) }).catch(error => { if (active) setError(error) })
    return () => { active = false }
  }, [document, projectPath, setError, historyRefresh])

  if (!document || !data || !projectPath) return <aside className="inspector"><div className="inspector-inner"><div className="empty-state"><Lightbulb size={22} /><div><strong>辅助栏</strong><span>选择章节后，这里会显示字数、设定链接、写作提示和版本历史。</span></div></div></div></aside>
  const attachments = linkedAttachments(data.entities, data.nodes, document.node.id)
  const currentDocument = document
  const currentProjectPath = projectPath
  const hints = writingHints(document.content)
  const targets = wikiTargets(document.content)
  const wordCount = countWords(document.content)
  const foundEntities = (title: string) => data.entities.filter((entity) => entity.title.trim() === title.trim())

  function openWikiTarget(target: string) {
    const matches = foundEntities(target)
    if (matches.length === 1) {
      selectEntity(matches[0].kind, matches[0].id)
      return
    }
    setView('search')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('novelforge:search-query', { detail: target })), 0)
  }

  function punctuation(direction: 'full' | 'half') {
    if (!window.confirm('这会生成一份替换后的正文并覆盖当前编辑内容，是否继续？')) return
    void protectedTransform(content => convertPunctuation(content, direction), '标点转换')
  }

  function width(direction: 'full' | 'half') {
    if (!window.confirm('这会转换正文中的 ASCII 字符为全角或半角（代码、链接地址、Wiki/脚注语法和 Markdown 标记会保留），是否继续？')) return
    void protectedTransform(direction === 'full' ? convertFullwidth : convertHalfwidth, '字符转换')
  }

  function transformContent(transform: (content: string) => string, message: string) {
    if (!window.confirm(message)) return
    void protectedTransform(transform, '批量整理正文')
  }

  async function protectedTransform(transform: (content: string) => string, name: string) {
    const source = currentDocument.content
    const next = transform(source)
    if (source === next) return
    try { await protectBeforeChange(source, name); if (isCurrent()) updateContent(next) } catch (error) { if (isCurrent()) setError(error) }
  }
  async function saveNamedVersion() {
    if (versionSaving || !versionName.trim() || !isCurrent()) return
    setVersionSaving(true)
    try {
      await projectApi.createHistorySnapshot({ projectPath: currentProjectPath, nodeId: currentDocument.node.id, content: currentDocument.content, kind: 'named', name: versionName.trim() })
      if (isCurrent()) { setVersionDialog(false); setVersionName(''); historyChanged() }
    } catch (error) { if (isCurrent()) setError(error) }
    finally { if (isCurrent()) setVersionSaving(false) }
  }
  const filteredHistory = history.filter(item => historyFilter === 'all' || (historyFilter === 'named' ? item.reason.startsWith('命名版本：') : historyFilter === 'automatic' ? item.reason === '自动保存' : item.reason.includes('保护') || item.reason.includes('恢复前')))
  const historyDate = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

  async function readRevision(id: string, mode: 'view' | 'diff' = 'view') {
    if (!isCurrent() || !history.some(item => item.id === id)) return
    const request = ++previewRequest.current
    try {
      const content = await projectApi.readHistory({ projectPath: currentProjectPath, revisionId: id })
      if (isCurrent() && request === previewRequest.current) setHistoryPreview({ id, content, mode })
    } catch (error) { if (isCurrent()) setError(error) }
  }

  async function copyRevision(id: string) {
    if (!isCurrent() || !history.some(item => item.id === id)) return
    const request = ++previewRequest.current
    try {
      const content = await projectApi.readHistory({ projectPath: currentProjectPath, revisionId: id })
      if (!isCurrent() || request !== previewRequest.current) return
      if (!await writeClipboardText(content)) {
        setError('无法访问系统剪贴板，请改用 Ctrl+C。')
        return
      }
      if (isCurrent() && request === previewRequest.current) setHistoryPreview({ id, content, mode: 'view' })
    } catch (error) { if (isCurrent()) setError(error) }
  }

  function openHistoryMenu(event: ReactMouseEvent<HTMLDivElement>, item: typeof history[number]) {
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'history-view', label: '查看', onSelect: () => void readRevision(item.id) },
      { type: 'item', id: 'history-diff', label: '查看 Diff', icon: GitCompare, onSelect: () => void readRevision(item.id, 'diff') },
      { type: 'item', id: 'history-copy', label: '复制版本内容', icon: Clipboard, onSelect: () => void copyRevision(item.id) },
      { type: 'separator' },
      { type: 'item', id: 'history-restore', label: '恢复版本', icon: RotateCcw, tone: 'danger', onSelect: () => void restoreRevision(item.id) },
    ]
    openContextMenu(event, { title: item.reason, location: 'history.revision', payload: { location: 'history.revision', projectPath: currentProjectPath, trashId: item.id }, items, trigger: event.currentTarget })
  }

  async function restoreRevision(id: string) {
    if (!isCurrent() || !history.some(item => item.id === id && item.nodeId === currentDocument.node.id)) return
    if (!window.confirm('恢复这个历史版本？当前内容会先生成新的历史快照。')) return
    const currentNodeId = currentDocument.node.id
    try {
      const store = useAppStore.getState()
      if (store.saveState !== 'saved' && !await store.saveCurrentDocument('恢复前保存')) return
      if (!isCurrent()) return
      const version = useAppStore.getState().documentVersion
      const result = await projectApi.restoreHistory({ projectPath: currentProjectPath, revisionId: id, expectedNodeId: currentNodeId })
      if (!isCurrentProjectSession(session)) return
      await refreshData(result, true, session)
      if (useAppStore.getState().document?.node.id === currentNodeId && useAppStore.getState().documentVersion === version) await useAppStore.getState().selectNode(currentNodeId, true)
      setHistoryPreview(null)
    } catch (error) { setError(error) }
  }

  return <aside className="inspector">
    <Modal open={versionDialog} title="保存命名版本" onClose={() => { if (!versionSaving) setVersionDialog(false) }} footer={<><Button variant="outline" disabled={versionSaving} onClick={() => setVersionDialog(false)}>取消</Button><Button disabled={versionSaving || !versionName.trim()} onClick={() => void saveNamedVersion()}>{versionSaving ? '保存中…' : '保存版本'}</Button></>}><Field label="版本名称"><TextInput value={versionName} maxLength={100} onChange={event => setVersionName(event.target.value)} placeholder="例如：修改结局前" /></Field><p className="field-hint">保存点击时本章的完整正文，作为长期保留的里程碑。</p></Modal>
    <div className="inspector-inner">
      <div className="inspector-head"><div><h2>辅助栏</h2><small>当前章节</small></div><span className="tag">{formatNumber(wordCount)} 字</span></div>
      <Disclosure title="章节信息" storageKey="inspector:chapter" defaultOpen className="inspector-disclosure"><div className="inspector-meta"><div className="meta-row"><span>标题</span><strong>{document.node.title}</strong></div><div className="meta-row"><span>状态</span><strong>{NODE_STATUS_LABELS[document.node.status] ?? document.node.status}</strong></div><details className="inspector-path"><summary>文件位置</summary><code>{document.node.filePath}</code></details><div className="meta-row"><span>更新时间</span><strong>{formatDate(document.node.updatedAt)}</strong></div></div></Disclosure>
      <Disclosure title="设定链接" meta={targets.length + ' 个'} storageKey="inspector:links" defaultOpen={targets.length > 0} className="inspector-disclosure">{targets.length ? <div className="wiki-list">{targets.map((target, index) => { const matches = foundEntities(target); const label = matches.length > 1 ? target + '（' + matches.length + ' 个同名）' : matches.length ? target : target + '（未建档）'; return <button type="button" key={target + '-' + String(index)} className={'wiki-chip' + (matches.length !== 1 ? ' missing' : '')} onClick={() => openWikiTarget(target)}>{label}</button> })}</div> : <span className="field-hint">在正文中输入 [[人物名]]、[[地点名]] 或 [[世界观条目]]，这里会自动列出链接。</span>}</Disclosure>
      <Disclosure title="关联附件" meta={attachments.length + ' 个'} storageKey="inspector:attachments" defaultOpen={attachments.length > 0} className="inspector-disclosure linked-attachments">{attachments.length ? <><div className="planning-reference-list">{attachments.map(attachment => <button type="button" className="planning-reference" key={attachment.id} onClick={() => selectEntity('attachment', attachment.id)}>{attachment.title}</button>)}</div><p className="field-hint">AI 辅助可显式勾选这些附件的说明文本。</p></> : <span className="field-hint">在资料附件中选择本章，参考素材就会显示在这里。</span>}</Disclosure>
      <Disclosure title="写作提示" meta={hints.length ? hints.length + ' 项' : '无待处理项'} storageKey="inspector:hints" defaultOpen={hints.length > 0} className="inspector-disclosure">{hints.length ? <div className="hint-list">{hints.slice(0, 4).map((hint, index) => <div className="hint-item" key={index}>第 {hint.line} 行：{hint.message}<small>{hint.sample || '空行'}</small></div>)}</div> : <div className="field-hint"><Lightbulb size={12} /> 暂未发现明显的标点或空白问题。</div>}<div className="inspector-actions" style={{ marginTop: 10 }}><Button variant="outline" onClick={() => punctuation('full')}>标点转全角</Button><Button variant="outline" onClick={() => punctuation('half')}>标点转半角</Button><Button variant="outline" onClick={() => width('full')}>字符转全角</Button><Button variant="outline" onClick={() => width('half')}>字符转半角</Button><Button variant="outline" onClick={() => transformContent(cleanWritingWhitespace, '清理行尾空格并合并连续空行？')}>清理空格/空行</Button><Button variant="outline" onClick={() => transformContent(indentParagraphs, '为普通段落添加全角空格首行缩进？')}>首行缩进</Button></div></Disclosure>
      <Disclosure title="本章识别" storageKey="inspector:mentions" className="inspector-disclosure inspector-widget"><MentionInspector /></Disclosure>
      <Disclosure title="剧情线" storageKey="inspector:arcs" className="inspector-disclosure inspector-widget"><StoryArcInspector /></Disclosure>
      <Disclosure title="章节完成" storageKey="inspector:checklist" className="inspector-disclosure inspector-widget"><ChapterChecklistInspector /></Disclosure>
      <div className="inspector-section"><NameGenerator /></div>
      <div className="inspector-section"><button className="inspector-collapse" onClick={() => setHistoryOpen(!historyOpen)}><span><History size={14} />版本历史</span>{historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{historyOpen ? <div className="history-list" style={{ marginTop: 11 }}><p className="field-hint">正文及时保存，自动版本间隔至少 5 分钟；相同内容不重复记录。命名版本和旧历史长期保留。</p><div className="history-tools"><Button variant="outline" onClick={() => setVersionDialog(true)}>保存版本</Button><select className="select-input" aria-label="筛选历史版本" value={historyFilter} onChange={event => { setHistoryFilter(event.target.value); setHistoryLimit(100) }}><option value="all">全部版本</option><option value="named">命名版本</option><option value="automatic">自动版本</option><option value="protected">操作保护</option></select></div>{filteredHistory.length ? filteredHistory.slice(0, historyLimit).map((item) => <div className="history-item" key={item.id} onContextMenu={(event) => openHistoryMenu(event, item)}><div><strong>{item.reason}</strong><small>{historyDate(item.createdAt)} · {formatNumber(item.wordCount)} 字</small></div><span><Button variant="ghost" onClick={() => void readRevision(item.id)}>查看</Button><Button variant="ghost" onClick={() => void readRevision(item.id, 'diff')}><GitCompare size={12} />Diff</Button><Button variant="ghost" onClick={() => void copyRevision(item.id)}><Clipboard size={12} />复制</Button><Button variant="ghost" onClick={() => void restoreRevision(item.id)}><RotateCcw size={12} />恢复</Button></span></div>) : <span className="field-hint">暂无匹配的历史版本。</span>}{filteredHistory.length > historyLimit ? <Button variant="outline" onClick={() => setHistoryLimit(value => value + 100)}>加载更早版本（剩余 {filteredHistory.length - historyLimit} 条）</Button> : null}{historyPreview ? historyPreview.mode === 'diff' ? <pre className="history-preview history-diff">{diffLines(historyPreview.content, document.content).map((line, index) => <span className={'diff-line ' + line.kind} key={index}>{line.kind === 'same' ? '  ' : line.kind === 'added' ? '+ ' : '- '}{line.text}{'\n'}</span>)}</pre> : <pre className="history-preview">{historyPreview.content}</pre> : null}</div> : null}</div>
    </div>
  </aside>
}
