import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { FileSearch, Search } from 'lucide-react'
import type { EntityKind } from '../lib/types'
import { ENTITY_LABELS } from '../lib/types'
import { searchSegments } from '../lib/search-data'
import { useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { TextInput } from './ui'
import { useContextMenu } from './ContextMenu'

export function SearchView() {
  const results = useAppStore((state) => state.searchResults)
  const runSearch = useAppStore((state) => state.runSearch)
  const setView = useAppStore((state) => state.setView)
  const selectNode = useAppStore((state) => state.selectNode)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const data = useAppStore((state) => state.data)
  const document = useAppStore((state) => state.document)
  const projectPath = useAppStore((state) => state.projectPath)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [scope, setScope] = useState<'project' | 'current'>('project')
  const [volumePath, setVolumePath] = useState('')
  const [tag, setTag] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  useEffect(() => {
    const onScope = (event: Event) => {
      const scope = (event as CustomEvent<'project' | 'current'>).detail
      if (scope === 'project' || scope === 'current') setScope(scope)
    }
    window.addEventListener('novelforge:search-scope', onScope)
    return () => window.removeEventListener('novelforge:search-scope', onScope)
  }, [])

  useEffect(() => {
    const onWikiSearch = (event: Event) => {
      const target = (event as CustomEvent<unknown>).detail
      if (typeof target !== 'string' || !target.trim()) return
      setQuery(target.trim())
      setKind('all')
      setScope('project')
      setVolumePath('')
      setTag('')
      setCaseSensitive(false)
    }
    window.addEventListener('novelforge:search-query', onWikiSearch)
    return () => window.removeEventListener('novelforge:search-query', onWikiSearch)
  }, [])

  const volumes = useMemo(() => (data?.nodes ?? [])
    .filter((node) => node.kind === 'volume')
    .sort((left, right) => left.orderIndex - right.orderIndex), [data?.nodes])

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query, {
      kind: kind === 'all' ? undefined : kind,
      scope,
      nodeId: document?.node.id,
      volumePath: volumePath || undefined,
      tag: tag || undefined,
      caseSensitive,
    }), 240)
    return () => clearTimeout(timer)
  }, [caseSensitive, document?.node.id, kind, query, runSearch, scope, tag, volumePath])

  function openResult(id: string, resultKind: string) {
    if (resultKind === 'chapter' || resultKind === 'section') {
      setView('manuscript')
      void selectNode(id)
    } else if (resultKind in ENTITY_LABELS) {
      selectEntity(resultKind as EntityKind, id)
    }
  }

  function openResultMenu(event: ReactMouseEvent<HTMLButtonElement>, result: typeof results[number]) {
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'search-open', label: '打开结果', icon: FileSearch, onSelect: () => openResult(result.id, result.kind) },
      { type: 'item', id: 'search-copy-title', label: '复制标题', onSelect: async () => { if (!await writeClipboardText(result.title)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'item', id: 'search-copy-path', label: '复制文件路径', onSelect: async () => { if (!await writeClipboardText(result.path)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
    ]
    openContextMenu(event, { title: result.title, location: 'search.result', payload: { location: 'search.result', projectPath: projectPath ?? undefined, nodeIds: [result.id], selectionText: result.snippet }, items, trigger: event.currentTarget })
  }

  return <div className="search-view">
    <div className="view-header" style={{ padding: 0, marginBottom: 18 }}><div><p className="eyebrow">SEARCH INDEX / FTS5</p><h1>全文搜索</h1><p>支持 FTS5 与中文内容回退匹配；可限制当前章节、卷、标签和大小写。</p></div></div>
    <div className="search-bar"><Search size={17} color="var(--muted)" style={{ marginTop: 10 }} /><TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词，例如：雾港、林月、失踪…" /><select className="select-input" style={{ width: 130 }} value={kind} onChange={(event) => setKind(event.target.value)} aria-label="搜索类型"><option value="all">全部范围</option><option value="manuscript">正文</option>{Object.entries(ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="search-filters"><select className="select-input" value={scope} onChange={(event) => setScope(event.target.value as 'project' | 'current')} aria-label="搜索范围"><option value="project">全项目</option><option value="current" disabled={!document}>当前章节</option></select><select className="select-input" value={volumePath} onChange={(event) => setVolumePath(event.target.value)} aria-label="按卷筛选"><option value="">全部卷</option>{volumes.map((volume) => <option key={volume.id} value={volume.filePath}>{volume.title}</option>)}</select><TextInput value={tag} onChange={(event) => setTag(event.target.value)} placeholder="标签过滤" aria-label="按标签筛选" /><label className="search-checkbox"><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />区分大小写</label></div>
    {query.trim() ? <div className="search-result-list">{results.length ? results.map((result) => <button className="search-result" key={result.id} onClick={() => openResult(result.id, result.kind)} onContextMenu={(event) => openResultMenu(event, result)}><div className="search-result-title"><strong>{result.title}</strong><span className="search-kind">{ENTITY_LABELS[result.kind as EntityKind] ?? result.kind}</span></div><p>{searchSegments(result.snippet || '匹配条目', query, caseSensitive).map((segment, index) => segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</p><small>{result.path}</small></button>) : <div className="empty-state"><FileSearch size={24} /><div><strong>没有找到匹配内容</strong><span>试试更短的关键词，或切换搜索范围。</span></div></div>}</div> : <div className="empty-state" style={{ minHeight: 330 }}><Search size={28} /><div><strong>从一个关键词开始</strong><span>搜索结果会显示匹配条目和正文片段；点击结果即可回到编辑器或资料卡。</span></div></div>}
  </div>
}
