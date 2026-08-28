import { useEffect, useState } from 'react'
import { FileSearch, Search } from 'lucide-react'
import type { EntityKind } from '../lib/types'
import { ENTITY_LABELS } from '../lib/types'
import { useAppStore } from '../stores/app-store'
import { TextInput } from './ui'

export function SearchView() {
  const results = useAppStore((state) => state.searchResults)
  const runSearch = useAppStore((state) => state.runSearch)
  const setView = useAppStore((state) => state.setView)
  const selectNode = useAppStore((state) => state.selectNode)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query, kind === 'all' ? undefined : kind), 240)
    return () => clearTimeout(timer)
  }, [query, kind, runSearch])

  function openResult(id: string, resultKind: string) {
    if (resultKind === 'chapter' || resultKind === 'section') {
      setView('manuscript')
      void selectNode(id)
    } else if (resultKind in ENTITY_LABELS) {
      selectEntity(resultKind as EntityKind, id)
    }
  }

  return <div className="search-view"><div className="view-header" style={{ padding: 0, marginBottom: 18 }}><div><p className="eyebrow">SEARCH INDEX / FTS5</p><h1>全文搜索</h1><p>搜索正文、资料和世界观。中文查询同时使用 FTS5 和内容回退匹配。</p></div></div><div className="search-bar"><Search size={17} color="var(--muted)" style={{ marginTop: 10 }} /><TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词，例如：雾港、林月、失踪…" /><select className="select-input" style={{ width: 130 }} value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">全部范围</option><option value="manuscript">正文</option>{Object.entries(ENTITY_LABELS).slice(0, 5).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{query.trim() ? <div className="search-result-list">{results.length ? results.map((result) => <button className="search-result" key={result.id} onClick={() => openResult(result.id, result.kind)}><div className="search-result-title"><strong>{result.title}</strong><span className="search-kind">{ENTITY_LABELS[result.kind as EntityKind] ?? result.kind}</span></div><p>{result.snippet || '匹配条目'}</p><small>{result.path}</small></button>) : <div className="empty-state"><FileSearch size={24} /><div><strong>没有找到匹配内容</strong><span>试试更短的关键词，或切换搜索范围。</span></div></div>}</div> : <div className="empty-state" style={{ minHeight: 330 }}><Search size={28} /><div><strong>从一个关键词开始</strong><span>搜索结果会显示匹配条目和正文片段；点击结果即可回到编辑器或资料卡。</span></div></div>}</div>
}
