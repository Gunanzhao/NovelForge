import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, History, Lightbulb, RotateCcw } from 'lucide-react'
import { projectApi } from '../lib/api'
import { cleanWritingWhitespace, convertPunctuation, indentParagraphs, wikiTargets, writingHints } from '../lib/markdown'
import { NODE_STATUS_LABELS } from '../lib/types'
import { countWords, formatDate, formatNumber } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import { Button } from './ui'
import { NameGenerator } from './NameGenerator'

export function Inspector() {
  const document = useAppStore((state) => state.document)
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const updateContent = useAppStore((state) => state.updateContent)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const refreshData = useAppStore((state) => state.refreshData)
  const setError = useAppStore((state) => state.setError)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<Awaited<ReturnType<typeof projectApi.listHistory>>>([])
  const [historyPreview, setHistoryPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath || !document) { setHistory([]); return }
    void projectApi.listHistory({ projectPath, nodeId: document.node.id }).then(setHistory).catch(setError)
  }, [document, projectPath, setError])

  if (!document || !data || !projectPath) return <aside className="inspector"><div className="inspector-inner"><div className="empty-state"><Lightbulb size={22} /><div><strong>辅助栏</strong><span>选择章节后，这里会显示字数、设定链接、写作提示和版本历史。</span></div></div></div></aside>
  const currentProjectPath = projectPath
  const hints = writingHints(document.content)
  const targets = wikiTargets(document.content)
  const wordCount = countWords(document.content)
  const foundEntity = (title: string) => data.entities.find((entity) => entity.title === title)

  function punctuation(direction: 'full' | 'half') {
    if (!window.confirm('这会生成一份替换后的正文并覆盖当前编辑内容，是否继续？')) return
    updateContent(convertPunctuation(document!.content, direction))
  }

  function transformContent(transform: (content: string) => string, message: string) {
    if (!window.confirm(message)) return
    updateContent(transform(document!.content))
  }

  async function readRevision(id: string) {
    try { setHistoryPreview(await projectApi.readHistory({ projectPath: currentProjectPath, revisionId: id })) } catch (error) { setError(error) }
  }

  async function restoreRevision(id: string) {
    if (!window.confirm('恢复这个历史版本？当前内容会先生成新的历史快照。')) return
    try {
      await refreshData(await projectApi.restoreHistory({ projectPath: currentProjectPath, revisionId: id }), true)
      setHistoryPreview(null)
    } catch (error) { setError(error) }
  }

  return <aside className="inspector">
    <div className="inspector-inner">
      <div className="inspector-head"><div><h2>辅助栏</h2><small>当前章节</small></div><span className="tag">{formatNumber(wordCount)} 字</span></div>
      <div className="inspector-section"><h3>章节信息</h3><div className="inspector-meta"><div className="meta-row"><span>标题</span><strong>{document.node.title}</strong></div><div className="meta-row"><span>状态</span><strong>{NODE_STATUS_LABELS[document.node.status] ?? document.node.status}</strong></div><div className="meta-row"><span>文件</span><strong className="path-text" title={document.node.filePath}>{document.node.filePath}</strong></div><div className="meta-row"><span>更新时间</span><strong>{formatDate(document.node.updatedAt)}</strong></div></div></div>
      <div className="inspector-section"><div className="panel-title"><h3>设定链接</h3><span>{targets.length} 个</span></div>{targets.length ? <div className="wiki-list">{targets.map((target) => { const entity = foundEntity(target); return <button key={target} className={'wiki-chip' + (entity ? '' : ' missing')} onClick={() => entity ? selectEntity(entity.kind, entity.id) : selectEntity('world')}>{entity ? target : target + '（未建档）'}</button> })}</div> : <span className="field-hint">在正文中输入 [[人物名]]、[[地点名]] 或 [[世界观条目]]，这里会自动列出链接。</span>}</div>
      <div className="inspector-section"><div className="panel-title"><h3>写作提示</h3><span>{hints.length ? hints.length + ' 项待确认' : '干净'}</span></div>{hints.length ? <div className="hint-list">{hints.slice(0, 4).map((hint, index) => <div className="hint-item" key={index}>第 {hint.line} 行：{hint.message}<small>{hint.sample || '空行'}</small></div>)}</div> : <div className="field-hint"><Lightbulb size={12} /> 暂未发现明显的标点或空白问题。</div>}<div className="inspector-actions" style={{ marginTop: 10 }}><Button variant="outline" onClick={() => punctuation('full')}>转全角</Button><Button variant="outline" onClick={() => punctuation('half')}>转半角</Button><Button variant="outline" onClick={() => transformContent(cleanWritingWhitespace, '清理行尾空格并合并连续空行？')}>清理空格/空行</Button><Button variant="outline" onClick={() => transformContent(indentParagraphs, '为普通段落添加全角空格首行缩进？')}>首行缩进</Button></div></div>
      <div className="inspector-section"><NameGenerator /></div>
      <div className="inspector-section"><button className="inspector-collapse" onClick={() => setHistoryOpen(!historyOpen)}><span><History size={14} />版本历史</span>{historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{historyOpen ? <div className="history-list" style={{ marginTop: 11 }}>{history.length ? history.map((item) => <div className="history-item" key={item.id}><div><strong>{item.reason}</strong><small>{formatDate(item.createdAt)} · {formatNumber(item.wordCount)} 字</small></div><span><Button variant="ghost" onClick={() => void readRevision(item.id)}>查看</Button><Button variant="ghost" onClick={() => void restoreRevision(item.id)}><RotateCcw size={12} />恢复</Button></span></div>) : <span className="field-hint">保存一次后会在这里留下快照。</span>}{historyPreview !== null ? <pre className="history-preview">{historyPreview}</pre> : null}</div> : null}</div>
    </div>
  </aside>
}
