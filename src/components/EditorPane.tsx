import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import {
  Bold, Code2, Columns3, Copy, Eye, Heading1, Image, Italic, Link, List, ListChecks, ListOrdered,
  Maximize2, Minus, PenLine, Quote, Redo2, Save, Search, Scissors, Sparkles, Strikethrough, Undo2,
} from 'lucide-react'
import {
  applyMarkdownCommand, wikiRanges, wikiTargetFromHref, type MarkdownCommand,
} from '../lib/markdown'
import type { ContextMenuItem } from '../lib/context-menu'
import { readClipboardText, writeClipboardText } from '../lib/clipboard'
import type { AiAction } from '../lib/ai-data'
import { ENTITY_LABELS, NODE_STATUS_LABELS, type EntityRecord } from '../lib/types'
import { useAppStore } from '../stores/app-store'
import { Button, IconButton } from './ui'
import { useContextMenu } from './ContextMenu'
import { MarkdownPreview } from './MarkdownPreview'

function wikiDecorationSet(source: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const decoration = Decoration.mark({ class: 'cm-wiki-link' })
  for (const range of wikiRanges(source)) builder.add(range.from, range.to, decoration)
  return builder.finish()
}

function wikiEditorExtension(onActivate: (target: string) => void) {
  const plugin = ViewPlugin.define((view) => {
    let decorations = wikiDecorationSet(view.state.doc.toString())
    return {
      get decorations() { return decorations },
      update(update: ViewUpdate) {
        if (update.docChanged) decorations = wikiDecorationSet(update.state.doc.toString())
      },
    }
  }, { decorations: (value) => value.decorations })
  return [
    plugin,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.ctrlKey && !event.metaKey) return false
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (position === null) return false
        const target = wikiRanges(view.state.doc.toString())
          .find((range) => position >= range.from && position <= range.to)?.target
        if (!target) return false
        event.preventDefault()
        onActivate(target)
        return true
      },
    }),
  ]
}

function wikiTitleKey(title: string) {
  return title.trim().toLocaleLowerCase()
}

export function EditorPane() {
  const document = useAppStore((state) => state.document)
  const data = useAppStore((state) => state.data)
  const editorMode = useAppStore((state) => state.editorMode)
  const saveState = useAppStore((state) => state.saveState)
  const updateContent = useAppStore((state) => state.updateContent)
  const setEditorMode = useAppStore((state) => state.setEditorMode)
  const saveCurrentDocument = useAppStore((state) => state.saveCurrentDocument)
  const setNodeStatus = useAppStore((state) => state.setNodeStatus)
  const toggleFocusMode = useAppStore((state) => state.toggleFocusMode)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const setView = useAppStore((state) => state.setView)
  const setEditorSelection = useAppStore((state) => state.setEditorSelection)
  const setError = useAppStore((state) => state.setError)
  const openAiAssistant = useAppStore((state) => state.openAiAssistant)
  const projectPath = useAppStore((state) => state.projectPath)
  const { openContextMenu } = useContextMenu()
  const editorViewRef = useRef<EditorView | null>(null)
  const [wikiResolution, setWikiResolution] = useState<{ target: string; candidates: EntityRecord[] } | null>(null)

  const resolveWikiTarget = useCallback((target: string) => {
    const normalized = wikiTitleKey(target)
    const candidates = (data?.entities ?? []).filter((entity) => wikiTitleKey(entity.title) === normalized)
    if (candidates.length === 1) {
      setWikiResolution(null)
      selectEntity(candidates[0].kind, candidates[0].id)
      return
    }
    setWikiResolution({ target: target.trim(), candidates })
  }, [data?.entities, selectEntity])

  const openWikiSearch = useCallback((target: string) => {
    setWikiResolution(null)
    setView('search')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('novelforge:search-query', { detail: target })), 0)
  }, [setView])

  const reportEditorSelection = useCallback((update: ViewUpdate) => {
    const nodeId = document?.node.id
    if (!nodeId) return
    const selection = update.state.selection.main
    setEditorSelection({
      nodeId,
      from: selection.from,
      to: selection.to,
      text: update.state.sliceDoc(selection.from, selection.to),
    })
  }, [document?.node.id, setEditorSelection])

  const extensions = useMemo(() => [
    markdown(),
    EditorView.lineWrapping,
    ...wikiEditorExtension(resolveWikiTarget),
  ], [resolveWikiTarget])
  const applyCommand = useCallback((command: MarkdownCommand) => {
    const view = editorViewRef.current
    if (!view || !view.dom.isConnected) return
    const selection = view.state.selection.main
    const source = view.state.doc.toString()
    const result = applyMarkdownCommand(source, selection.from, selection.to, command)
    const insertedEnd = result.text.length - (source.length - selection.to)
    const inserted = result.text.slice(selection.from, insertedEnd)
    view.dispatch(view.state.update({
      changes: { from: selection.from, to: selection.to, insert: inserted },
      selection: { anchor: result.selection.from, head: result.selection.to },
      userEvent: 'input',
    }))
    view.focus()
  }, [])

  const openEditorContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const view = editorViewRef.current
    if (!view || !view.dom.isConnected || !document) return
    const point = view.posAtCoords({ x: event.clientX, y: event.clientY })
    const before = view.state.selection.main
    const insideSelection = before.from !== before.to && point !== null && point >= before.from && point <= before.to
    if (!insideSelection && point !== null) view.dispatch({ selection: { anchor: point } })
    const selection = view.state.selection.main
    const selectionText = view.state.sliceDoc(selection.from, selection.to)
    setEditorSelection({ nodeId: document.node.id, from: selection.from, to: selection.to, text: selectionText })
    const hasSelection = selection.from !== selection.to
    const copySelection = async () => {
      if (!await writeClipboardText(selectionText)) setError('无法访问系统剪贴板，请改用 Ctrl+C。')
    }
    const cutSelection = async () => {
      if (!await writeClipboardText(selectionText)) {
        setError('无法访问系统剪贴板，请改用 Ctrl+X。')
        return
      }
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: '' }, selection: { anchor: selection.from }, userEvent: 'delete.cut' })
      view.focus()
    }
    const pasteSelection = async () => {
      const result = await readClipboardText()
      if (!result.ok || typeof result.text !== 'string') {
        setError('无法访问系统剪贴板，请改用 Ctrl+V。')
        return
      }
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: result.text }, selection: { anchor: selection.from + result.text.length }, userEvent: 'input.paste' })
      view.focus()
    }
    const search = (query: string, scope: 'current' | 'project') => {
      setView('search')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('novelforge:search-scope', { detail: scope }))
        window.dispatchEvent(new CustomEvent('novelforge:search-query', { detail: query }))
      }, 0)
    }
    const formatCommands: Array<[MarkdownCommand, string]> = [
      ['bold', '粗体'], ['italic', '斜体'], ['strikethrough', '删除线'], ['code', '行内代码'],
      ['heading', '标题'], ['quote', '引用'], ['unordered-list', '无序列表'], ['ordered-list', '有序列表'],
      ['task-list', '任务列表'], ['link', '链接'], ['image', '图片'], ['horizontal-rule', '分割线'],
    ]
    const formatItems: ContextMenuItem[] = formatCommands.map(([command, label]) => ({ type: 'item' as const, id: 'format-' + command, label, onSelect: () => applyCommand(command) }))
    const selectionAi: Array<[AiAction, string]> = [['polish', '润色'], ['rewrite', '改写'], ['expand', '扩写'], ['shrink', '缩写']]
    const cursorAi: Array<[AiAction, string]> = [['continue', '续写'], ['chapter-summary', '章节摘要'], ['outline', '生成大纲'], ['dialogue', '角色对话'], ['setting-advice', '设定建议'], ['name', '名字生成']]
    const aiItems = (actions: Array<[AiAction, string]>) => actions.map(([action, label]) => ({ type: 'item' as const, id: 'ai-' + action, label, disabled: !document, onSelect: () => openAiAssistant(action) }))
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'editor-undo', label: '撤销', icon: Undo2, onSelect: () => { undo(view); view.focus() } },
      { type: 'item', id: 'editor-redo', label: '重做', icon: Redo2, onSelect: () => { redo(view); view.focus() } },
      { type: 'item', id: 'editor-cut', label: '剪切', icon: Scissors, shortcut: 'Ctrl+X', disabled: !hasSelection, onSelect: cutSelection },
      { type: 'item', id: 'editor-copy', label: '复制', icon: Copy, shortcut: 'Ctrl+C', disabled: !hasSelection, onSelect: copySelection },
      { type: 'item', id: 'editor-paste', label: '粘贴', shortcut: 'Ctrl+V', onSelect: pasteSelection },
      { type: 'separator' },
      { type: 'item', id: 'editor-format', label: '格式', children: formatItems, onSelect: () => undefined },
      { type: 'item', id: 'editor-ai', label: 'AI 处理选区', disabled: !hasSelection, children: aiItems(selectionAi), onSelect: () => undefined },
      { type: 'item', id: 'editor-ai-open', label: '打开 AI 辅助', icon: Sparkles, onSelect: () => openAiAssistant(hasSelection ? 'polish' : 'continue') },
      { type: 'item', id: 'editor-search-current', label: hasSelection ? '搜索所选文字（当前章节）' : '当前章节搜索', icon: Search, disabled: !hasSelection, onSelect: () => search(selectionText, 'current') },
      { type: 'item', id: 'editor-search-project', label: hasSelection ? '搜索所选文字（全项目）' : '全项目搜索', icon: Search, disabled: !hasSelection, onSelect: () => search(selectionText, 'project') },
      { type: 'item', id: 'editor-ai-cursor', label: 'AI 写作任务', disabled: hasSelection, children: aiItems(cursorAi), onSelect: () => undefined },
      { type: 'separator' },
      { type: 'item', id: 'editor-select-all', label: '全选', shortcut: 'Ctrl+A', onSelect: () => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus() } },
    ]
    const location = hasSelection ? 'editor.selection' : 'editor.cursor'
    openContextMenu(event, { title: document.node.title, location, payload: { location, projectPath: projectPath ?? undefined, nodeIds: [document.node.id], nodeKind: document.node.kind, selectionText: selectionText || undefined }, items, trigger: view.dom })
  }, [applyCommand, document, openAiAssistant, openContextMenu, projectPath, setEditorSelection, setError, setView])

  const handlePreviewContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(anchor instanceof HTMLAnchorElement)) return
    const target = wikiTargetFromHref(anchor.getAttribute('href') ?? undefined)
    if (!target) return
    const wikiLink = '[[' + target + ']]'
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'wiki-open', label: '打开资料', onSelect: () => resolveWikiTarget(target) },
      { type: 'item', id: 'wiki-copy', label: '复制 Wiki 链接', icon: Copy, onSelect: async () => { if (!await writeClipboardText(wikiLink)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'item', id: 'wiki-search', label: '搜索目标', icon: Search, onSelect: () => openWikiSearch(target) },
    ]
    openContextMenu(event, { title: target, location: 'editor.preview', payload: { location: 'editor.preview', selectionText: wikiLink }, items, trigger: event.currentTarget })
  }, [openContextMenu, openWikiSearch, resolveWikiTarget, setError])

  useEffect(() => {
    const onEditorCommand = (event: Event) => {
      const command = (event as CustomEvent<unknown>).detail
      if (command === 'bold' || command === 'italic') applyCommand(command)
    }
    window.addEventListener('novelforge:editor-command', onEditorCommand)
    return () => window.removeEventListener('novelforge:editor-command', onEditorCommand)
  }, [applyCommand])

  useEffect(() => {
    const onWikiLinkClick = (event: Event) => {
      const target = (event as CustomEvent<unknown>).detail
      if (typeof target === 'string' && target.trim()) resolveWikiTarget(target)
    }
    window.addEventListener('novelforge:wiki-link-click', onWikiLinkClick)
    return () => window.removeEventListener('novelforge:wiki-link-click', onWikiLinkClick)
  }, [resolveWikiTarget])

  if (!document) return <div className="editor-placeholder"><div><PenLine size={27} /><strong>选择一个章节开始写作</strong><span>正文以 Markdown 文件保存，切换章节不会加载整本小说。</span></div></div>

  return <div className="manuscript-view">
    <div className="editor-header">
      <div className="editor-title-row"><div><p className="eyebrow">MANUSCRIPT / {document.node.kind.toUpperCase()}</p><h1>{document.node.title}</h1></div><span>{document.node.filePath}</span><IconButton icon={Maximize2} label="专注模式（F11）" onClick={toggleFocusMode} /></div>
      <div className="editor-toolbar">
        <IconButton icon={Bold} label="粗体（Ctrl+B）" onClick={() => applyCommand('bold')} /><IconButton icon={Italic} label="斜体（Ctrl+I）" onClick={() => applyCommand('italic')} /><IconButton icon={Strikethrough} label="删除线" onClick={() => applyCommand('strikethrough')} /><IconButton icon={Heading1} label="标题" onClick={() => applyCommand('heading')} /><IconButton icon={Quote} label="引用" onClick={() => applyCommand('quote')} /><IconButton icon={List} label="无序列表" onClick={() => applyCommand('unordered-list')} /><IconButton icon={ListOrdered} label="有序列表" onClick={() => applyCommand('ordered-list')} /><IconButton icon={ListChecks} label="任务列表" onClick={() => applyCommand('task-list')} /><IconButton icon={Link} label="链接" onClick={() => applyCommand('link')} /><IconButton icon={Image} label="图片" onClick={() => applyCommand('image')} /><IconButton icon={Code2} label="代码" onClick={() => applyCommand('code')} /><IconButton icon={Minus} label="分割线" onClick={() => applyCommand('horizontal-rule')} />
        <span className="toolbar-separator" /><Button variant="ghost" onClick={() => void saveCurrentDocument('手动保存')}><Save size={14} />保存</Button>
        <span className="mode-switch"><button className={editorMode === 'markdown' ? 'active' : ''} onClick={() => setEditorMode('markdown')}><PenLine size={12} /> 编辑</button><button className={editorMode === 'split' ? 'active' : ''} onClick={() => setEditorMode('split')}><Columns3 size={12} /> 分栏</button><button className={editorMode === 'preview' ? 'active' : ''} onClick={() => setEditorMode('preview')}><Eye size={12} /> 预览</button></span>
      </div>
    </div>
    <div className={'editor-body mode-' + editorMode}>
      {editorMode !== 'preview' ? <div className="editor-pane" onContextMenu={openEditorContextMenu}><CodeMirror value={document.content} height="100%" theme="none" extensions={extensions} onCreateEditor={(view) => { editorViewRef.current = view; reportEditorSelection({ state: view.state } as ViewUpdate) }} onUpdate={reportEditorSelection} onChange={(value) => updateContent(value)} /></div> : null}
      {editorMode !== 'markdown' ? <div className="editor-pane" onContextMenu={handlePreviewContextMenu}><article className="preview"><MarkdownPreview markdown={document.content} entities={data?.entities} onWikiLink={resolveWikiTarget} /></article></div> : null}
    </div>
    {wikiResolution ? <div className="wiki-resolution" role="status">
      <div className="wiki-resolution-copy"><strong>{wikiResolution.target}</strong><span>{wikiResolution.candidates.length > 1 ? '找到多个同名条目，请选择要打开的资料。' : '没有找到对应资料，可以先去搜索项目内容。'}</span></div>
      {wikiResolution.candidates.length ? <div className="wiki-resolution-candidates">{wikiResolution.candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => { setWikiResolution(null); selectEntity(candidate.kind, candidate.id) }}><strong>{candidate.title}</strong><span>{ENTITY_LABELS[candidate.kind]} · {candidate.filePath}</span></button>)}</div> : <div className="wiki-resolution-actions"><Button variant="outline" onClick={() => openWikiSearch(wikiResolution.target)}>去搜索</Button><Button variant="ghost" onClick={() => setWikiResolution(null)}>关闭</Button></div>}
    </div> : null}
    <div className="editor-subbar"><span className={'save-indicator ' + saveState}>{saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败，恢复数据已保留' : saveState === 'saved' ? '已保存' : '有未保存修改'}</span><span>{document.content.length} 字符</span><label>状态 <select className="status-select" value={document.node.status} onChange={(event) => void setNodeStatus(document.node.id, event.target.value)}>{Object.entries(NODE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
  </div>
}
