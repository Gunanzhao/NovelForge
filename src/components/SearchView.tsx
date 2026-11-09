import { Disclosure } from './Disclosure'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { FileSearch, Search } from 'lucide-react'
import type { EntityKind, SearchResult } from '../lib/types'
import { ENTITY_LABELS } from '../lib/types'
import { findSearchMatch, searchSegments } from '../lib/search-data'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { defaultSearchFilters, rememberSearchResult, rememberSearchScroll, searchScrollPosition, updateSearchFilters, useSearchWorkspace } from '../lib/search-workspace'
import { jumpToText } from '../lib/text-navigation'
import { notify } from '../lib/notifications'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { Button, TextInput } from './ui'
import { useContextMenu } from './ContextMenu'

export function SearchView() {
  const results = useAppStore((state) => state.searchResults)
  const runSearch = useAppStore((state) => state.runSearch)
  const selectNode = useAppStore((state) => state.selectNode)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const data = useAppStore((state) => state.data)
  const document = useAppStore((state) => state.document)
  const projectPath = useAppStore((state) => state.projectPath)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const savedFilters = useSearchWorkspace(state => state.value?.filters)
  const savedSession = useSearchWorkspace(state => state.value?.session)
  const { query, kind, scope, nodeId, volumePath, tag, caseSensitive } =
    savedSession && isCurrentProjectSession(savedSession) ? savedFilters ?? defaultSearchFilters : defaultSearchFilters
  const [completedKey, setCompletedKey] = useState('')
  const searchKey = JSON.stringify([projectPath, query, kind, scope, nodeId, volumePath, tag, caseSensitive])
  const searching = Boolean(query.trim()) && completedKey !== searchKey
  const page = useRef<HTMLDivElement>(null)

  const volumes = useMemo(() => (data?.nodes ?? [])
    .filter((node) => node.kind === 'volume')
    .sort((left, right) => left.orderIndex - right.orderIndex), [data?.nodes])

  useEffect(() => {
    let current = true
    const done = () => { if (current) setCompletedKey(searchKey) }
    const timer = setTimeout(() => void runSearch(query, {
      kind: kind === 'all' ? undefined : kind,
      scope,
      nodeId: nodeId ?? undefined,
      volumePath: volumePath || undefined,
      tag: tag || undefined,
      caseSensitive,
    }).then(done, done), 240)
    return () => { current = false; clearTimeout(timer) }
  }, [caseSensitive, kind, nodeId, query, runSearch, scope, searchKey, tag, volumePath])

  useLayoutEffect(() => {
    if (!searching && page.current) page.current.scrollTop = searchScrollPosition()
  }, [searchKey, searching])

  async function openResult(result: SearchResult) {
    if (page.current) rememberSearchScroll(page.current.scrollTop)
    if (result.kind === 'chapter' || result.kind === 'section') {
      const session = captureProjectSession()
      await selectNode(result.id)
      const state = useAppStore.getState()
      if (!isCurrentProjectSession(session) || state.activeView !== 'manuscript' || state.document?.node.id !== result.id) return
      rememberSearchResult(result.id)
      const { content } = state.document
      const range = findSearchMatch(content, query, result.snippet, caseSensitive)
      if (!range) {
        notify({ message: '已打开章节；当前正文中没有可定位的匹配。', session: session.generation })
        return
      }
      try { await jumpToText(result.id, content, range.from, range.to) }
      catch (error) { if (isCurrentProjectSession(session)) setError(error) }
    } else if (result.kind in ENTITY_LABELS) {
      selectEntity(result.kind as EntityKind, result.id)
    }
  }

  function openResultMenu(event: ReactMouseEvent<HTMLButtonElement>, result: typeof results[number]) {
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'search-open', label: '打开结果', icon: FileSearch, onSelect: () => openResult(result) },
      { type: 'item', id: 'search-copy-title', label: '复制标题', onSelect: async () => { if (!await writeClipboardText(result.title)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'item', id: 'search-copy-path', label: '复制文件路径', onSelect: async () => { if (!await writeClipboardText(result.path)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
    ]
    openContextMenu(event, { title: result.title, location: 'search.result', payload: { location: 'search.result', projectPath: projectPath ?? undefined, nodeIds: [result.id], selectionText: result.snippet }, items, trigger: event.currentTarget })
  }

  return <div className="search-view" ref={page} onScroll={event => { if (!searching) rememberSearchScroll(event.currentTarget.scrollTop) }}>
    <div className="view-header" style={{ padding: 0, marginBottom: 18 }}><div><p className="eyebrow">PROJECT SEARCH</p><h1>全文搜索</h1><p>查找正文和资料，点击正文结果可定位到匹配段落。</p></div></div>
    <div className="search-bar"><Search size={17} color="var(--muted)" style={{ marginTop: 10 }} />
      <TextInput autoFocus value={query} onChange={event => updateSearchFilters({ query: event.target.value })} aria-label="搜索关键词" placeholder="输入关键词，例如：雾港、林月、失踪…" />
      <select className="select-input" style={{ width: 130 }} value={kind} onChange={event => updateSearchFilters({ kind: event.target.value })} aria-label="搜索类型"><option value="all">全部范围</option><option value="manuscript">正文</option>{Object.entries(ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    <Disclosure title="更多筛选" storageKey="search:advanced" meta={[scope !== 'project', Boolean(volumePath), Boolean(tag), caseSensitive].filter(Boolean).length + ' 项已启用'} className="search-advanced">
      <div className="search-filters">
        <select className="select-input" value={scope} onChange={event => updateSearchFilters({ scope: event.target.value === 'current' ? 'current' : 'project', nodeId: event.target.value === 'current' ? document?.node.id ?? null : null })} aria-label="搜索范围"><option value="project">全项目</option><option value="current" disabled={!document}>当前章节</option></select>
        <select className="select-input" value={volumePath} onChange={event => updateSearchFilters({ volumePath: event.target.value })} aria-label="按卷筛选"><option value="">全部卷</option>{volumes.map(volume => <option key={volume.id} value={volume.filePath}>{volume.title}</option>)}</select>
        <TextInput value={tag} onChange={event => updateSearchFilters({ tag: event.target.value })} placeholder="标签过滤" aria-label="按标签筛选" />
        <label className="search-checkbox"><input type="checkbox" checked={caseSensitive} onChange={event => updateSearchFilters({ caseSensitive: event.target.checked })} />区分大小写</label>
      </div>
    </Disclosure>
    <div className="search-active-filters">
      {scope === 'current' ? <span>章节：{data?.nodes.find(node => node.id === nodeId)?.title ?? '不可用'}</span> : null}
      {volumePath ? <span>{volumes.find(volume => volume.filePath === volumePath)?.title}</span> : null}
      {tag ? <span>标签：{tag}</span> : null}{caseSensitive ? <span>区分大小写</span> : null}
      {scope !== 'project' || volumePath || tag || caseSensitive || kind !== 'all' ? <Button variant="ghost" onClick={() => updateSearchFilters({ ...defaultSearchFilters, query })}>清除筛选</Button> : null}
    </div>
    {query.trim() ? <div className="search-result-list" aria-busy={searching}>{searching ? <div className="empty-state" role="status">正在查找匹配内容…</div> : results.length ? results.map(result =>
      <button className="search-result" key={result.id} onClick={() => void openResult(result)} onContextMenu={event => openResultMenu(event, result)}>
        <div className="search-result-title"><strong>{result.title}</strong><span className="search-kind">{result.kind === 'chapter' ? '章节' : result.kind === 'section' ? '小节' : ENTITY_LABELS[result.kind as EntityKind] ?? result.kind}</span></div>
        <p>{searchSegments(result.snippet || '匹配条目', query, caseSensitive).map((segment, index) => segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</p><small>{result.path}</small>
      </button>) : <div className="empty-state"><FileSearch size={24} /><div><strong>没有找到匹配内容</strong><span>试试更短的关键词，或切换搜索范围。</span></div></div>}</div>
      : <div className="empty-state" style={{ minHeight: 330 }}><Search size={28} /><div><strong>从一个关键词开始</strong><span>搜索结果会显示匹配条目和正文片段。</span></div></div>}
  </div>
}
