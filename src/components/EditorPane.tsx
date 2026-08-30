import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import {
  Bold, Code2, Columns3, Eye, Heading1, Image, Italic, Link, List, ListChecks, ListOrdered,
  Maximize2, Minus, PenLine, Quote, Save, Strikethrough,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  applyMarkdownCommand, wikiMarkdown, wikiRanges, wikiTargetFromHref, type MarkdownCommand,
} from '../lib/markdown'
import { ENTITY_LABELS, NODE_STATUS_LABELS, type EntityRecord } from '../lib/types'
import { useAppStore } from '../stores/app-store'
import { Button, IconButton } from './ui'

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

  const previewComponents = useMemo(() => ({
    a: ({ node, href, children, ...anchorProps }: ComponentProps<'a'> & { node?: unknown }) => {
      void node
      const target = wikiTargetFromHref(href)
      if (!target) return <a {...anchorProps} href={href}>{children}</a>
      const candidates = (data?.entities ?? []).filter((entity) => wikiTitleKey(entity.title) === wikiTitleKey(target))
      const duplicate = candidates.length > 1
      return <a
        {...anchorProps}
        href={href}
        className={'wiki-link' + (duplicate ? ' ambiguous' : candidates.length ? '' : ' missing')}
        aria-label={duplicate ? target + '（多个同名条目）' : candidates.length ? target : target + '（未建档）'}
        onClick={(event) => {
          event.preventDefault()
          resolveWikiTarget(target)
        }}
      >{children}</a>
    },
  }), [data?.entities, resolveWikiTarget])

  if (!document) return <div className="editor-placeholder"><div><PenLine size={27} /><strong>选择一个章节开始写作</strong><span>正文以 Markdown 文件保存，切换章节不会加载整本小说。</span></div></div>
  const preview = wikiMarkdown(document.content)

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
      {editorMode !== 'preview' ? <div className="editor-pane"><CodeMirror value={document.content} height="100%" theme="none" extensions={extensions} onCreateEditor={(view) => { editorViewRef.current = view }} onChange={(value) => updateContent(value)} /></div> : null}
      {editorMode !== 'markdown' ? <div className="editor-pane"><article className="preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={previewComponents} urlTransform={(url) => url}>{preview}</ReactMarkdown></article></div> : null}
    </div>
    {wikiResolution ? <div className="wiki-resolution" role="status">
      <div className="wiki-resolution-copy"><strong>{wikiResolution.target}</strong><span>{wikiResolution.candidates.length > 1 ? '找到多个同名条目，请选择要打开的资料。' : '没有找到对应资料，可以先去搜索项目内容。'}</span></div>
      {wikiResolution.candidates.length ? <div className="wiki-resolution-candidates">{wikiResolution.candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => { setWikiResolution(null); selectEntity(candidate.kind, candidate.id) }}><strong>{candidate.title}</strong><span>{ENTITY_LABELS[candidate.kind]} · {candidate.filePath}</span></button>)}</div> : <div className="wiki-resolution-actions"><Button variant="outline" onClick={() => openWikiSearch(wikiResolution.target)}>去搜索</Button><Button variant="ghost" onClick={() => setWikiResolution(null)}>关闭</Button></div>}
    </div> : null}
    <div className="editor-subbar"><span className={'save-indicator ' + saveState}>{saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败，恢复数据已保留' : saveState === 'saved' ? '已保存' : '有未保存修改'}</span><span>{document.content.length} 字符</span><label>状态 <select className="status-select" value={document.node.status} onChange={(event) => void setNodeStatus(document.node.id, event.target.value)}>{Object.entries(NODE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
  </div>
}
