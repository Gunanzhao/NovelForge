import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, ChevronUp, Clipboard, GitCompare, History, Lightbulb, RotateCcw } from 'lucide-react'
import { projectApi } from '../lib/api'
import { cleanWritingWhitespace, convertFullwidth, convertHalfwidth, convertPunctuation, indentParagraphs, wikiTargets, writingHints } from '../lib/markdown'
import { diffLines } from '../lib/text-diff'
import { NODE_STATUS_LABELS } from '../lib/types'
import { countWords, formatDate, formatNumber } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { Button } from './ui'
import { NameGenerator } from './NameGenerator'
import { useContextMenu } from './ContextMenu'

export function Inspector() {
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
  const [history, setHistory] = useState<Awaited<ReturnType<typeof projectApi.listHistory>>>([])
  const [historyPreview, setHistoryPreview] = useState<{ id: string; content: string; mode: 'view' | 'diff' } | null>(null)

  useEffect(() => {
    if (!projectPath || !document) { setHistory([]); return }
    void projectApi.listHistory({ projectPath, nodeId: document.node.id }).then(setHistory).catch(setError)
  }, [document, projectPath, setError])

  if (!document || !data || !projectPath) return <aside className="inspector"><div className="inspector-inner"><div className="empty-state"><Lightbulb size={22} /><div><strong>辅助栏</strong><span>选择章节后，这里会显示字数、设定链接、写作提示和版本历史。</span></div></div></div></aside>
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
    updateContent(convertPunctuation(document!.content, direction))
  }

  function width(direction: 'full' | 'half') {
    if (!window.confirm('这会转换正文中的英文字母和数字（代码、链接和 Markdown 标记会保留），是否继续？')) return
    updateContent(direction === 'full' ? convertFullwidth(document!.content) : convertHalfwidth(document!.content))
  }

  function transformContent(transform: (content: string) => string, message: string) {
    if (!window.confirm(message)) return
    updateContent(transform(document!.content))
  }

  async function readRevision(id: string, mode: 'view' | 'diff' = 'view') {
    try {
      const content = await projectApi.readHistory({ projectPath: currentProjectPath, revisionId: id })
      setHistoryPreview({ id, content, mode })
    } catch (error) { setError(error) }
  }

  async function copyRevision(id: string) {
    try {
      const content = await projectApi.readHistory({ projectPath: currentProjectPath, revisionId: id })
      if (!await writeClipboardText(content)) {
        setError('无法访问系统剪贴板，请改用 Ctrl+C。')
        return
      }
      setHistoryPreview({ id, content, mode: 'view' })
    } catch (error) { setError(error) }
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
    if (!window.confirm('恢复这个历史版本？当前内容会先生成新的历史快照。')) return
    const currentNodeId = currentDocument.node.id
    try {
      await refreshData(await projectApi.restoreHistory({ projectPath: currentProjectPath, revisionId: id }), true)
      await useAppStore.getState().selectNode(currentNodeId)
      setHistoryPreview(null)
    } catch (error) { setError(error) }
  }

  return <aside className="inspector">
    <div className="inspector-inner">
      <div className="inspector-head"><div><h2>辅助栏</h2><small>当前章节</small></div><span className="tag">{formatNumber(wordCount)} 字</span></div>
      <div className="inspector-section"><h3>章节信息</h3><div className="inspector-meta"><div className="meta-row"><span>标题</span><strong>{document.node.title}</strong></div><div className="meta-row"><span>状态</span><strong>{NODE_STATUS_LABELS[document.node.status] ?? document.node.status}</strong></div><div className="meta-row"><span>文件</span><strong className="path-text" title={document.node.filePath}>{document.node.filePath}</strong></div><div className="meta-row"><span>更新时间</span><strong>{formatDate(document.node.updatedAt)}</strong></div></div></div>
      <div className="inspector-section"><div className="panel-title"><h3>设定链接</h3><span>{targets.length} 个</span></div>{targets.length ? <div className="wiki-list">{targets.map((target, index) => { const matches = foundEntities(target); const label = matches.length > 1 ? target + '（' + matches.length + ' 个同名）' : matches.length ? target : target + '（未建档）'; return <button type="button" key={target + '-' + String(index)} className={'wiki-chip' + (matches.length !== 1 ? ' missing' : '')} onClick={() => openWikiTarget(target)}>{label}</button> })}</div> : <span className="field-hint">在正文中输入 [[人物名]]、[[地点名]] 或 [[世界观条目]]，这里会自动列出链接。</span>}</div>
      <div className="inspector-section"><div className="panel-title"><h3>写作提示</h3><span>{hints.length ? hints.length + ' 项待确认' : '干净'}</span></div>{hints.length ? <div className="hint-list">{hints.slice(0, 4).map((hint, index) => <div className="hint-item" key={index}>第 {hint.line} 行：{hint.message}<small>{hint.sample || '空行'}</small></div>)}</div> : <div className="field-hint"><Lightbulb size={12} /> 暂未发现明显的标点或空白问题。</div>}<div className="inspector-actions" style={{ marginTop: 10 }}><Button variant="outline" onClick={() => punctuation('full')}>标点转全角</Button><Button variant="outline" onClick={() => punctuation('half')}>标点转半角</Button><Button variant="outline" onClick={() => width('full')}>字符转全角</Button><Button variant="outline" onClick={() => width('half')}>字符转半角</Button><Button variant="outline" onClick={() => transformContent(cleanWritingWhitespace, '清理行尾空格并合并连续空行？')}>清理空格/空行</Button><Button variant="outline" onClick={() => transformContent(indentParagraphs, '为普通段落添加全角空格首行缩进？')}>首行缩进</Button></div></div>
      <div className="inspector-section"><NameGenerator /></div>
      <div className="inspector-section"><button className="inspector-collapse" onClick={() => setHistoryOpen(!historyOpen)}><span><History size={14} />版本历史</span>{historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{historyOpen ? <div className="history-list" style={{ marginTop: 11 }}>{history.length ? history.map((item) => <div className="history-item" key={item.id} onContextMenu={(event) => openHistoryMenu(event, item)}><div><strong>{item.reason}</strong><small>{formatDate(item.createdAt)} · {formatNumber(item.wordCount)} 字</small></div><span><Button variant="ghost" onClick={() => void readRevision(item.id)}>查看</Button><Button variant="ghost" onClick={() => void readRevision(item.id, 'diff')}><GitCompare size={12} />Diff</Button><Button variant="ghost" onClick={() => void copyRevision(item.id)}><Clipboard size={12} />复制</Button><Button variant="ghost" onClick={() => void restoreRevision(item.id)}><RotateCcw size={12} />恢复</Button></span></div>) : <span className="field-hint">保存一次后会在这里留下快照。</span>}{historyPreview ? historyPreview.mode === 'diff' ? <pre className="history-preview history-diff">{diffLines(historyPreview.content, document.content).map((line, index) => <span className={'diff-line ' + line.kind} key={index}>{line.kind === 'same' ? '  ' : line.kind === 'added' ? '+ ' : '- '}{line.text}{'\\n'}</span>)}</pre> : <pre className="history-preview">{historyPreview.content}</pre> : null}</div> : null}</div>
    </div>
  </aside>
}
