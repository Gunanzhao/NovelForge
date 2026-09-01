import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { CircleUserRound, GitBranch, Link2, Plus, Save, Search, Trash2 } from 'lucide-react'
import type { EntityRecord } from '../lib/types'
import { buildRelationshipGraph, relationshipDetails, relationshipTitle } from '../lib/relationship-data'
import { useAppStore } from '../stores/app-store'
import type { ContextMenuItem } from '../lib/context-menu'
import { writeClipboardText } from '../lib/clipboard'
import { Button, Field, Panel, TextInput } from './ui'
import { useContextMenu } from './ContextMenu'

interface RelationshipDraft {
  fromId: string
  toId: string
  label: string
  strength: string
  notes: string
}

function blankDraft(characters: EntityRecord[]) {
  return {
    fromId: characters[0]?.id ?? '',
    toId: characters[1]?.id ?? characters[0]?.id ?? '',
    label: '',
    strength: '普通',
    notes: '',
  }
}

function toDraft(entity: EntityRecord | undefined, characters: EntityRecord[]) {
  const draft = blankDraft(characters)
  if (!entity) return draft
  const details = relationshipDetails(entity)
  return {
    fromId: characters.some((character) => character.id === details.fromId) ? details.fromId : draft.fromId,
    toId: characters.some((character) => character.id === details.toId) ? details.toId : draft.toId,
    label: details.label,
    strength: details.strength || '普通',
    notes: details.notes,
  }
}

export function RelationshipsView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const setView = useAppStore((state) => state.setView)
  const setError = useAppStore((state) => state.setError)
  const { openContextMenu } = useContextMenu()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<RelationshipDraft>(() => blankDraft([]))
  const [busy, setBusy] = useState(false)

  const characters = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'character').sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')), [data?.entities])
  const relationships = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'relationship'), [data?.entities])
  const characterById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters])
  const visibleRelationships = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    if (!query) return relationships
    return relationships.filter((relationship) => {
      const details = relationshipDetails(relationship)
      const from = characterById.get(details.fromId)?.title ?? ''
      const to = characterById.get(details.toId)?.title ?? ''
      return [relationship.title, from, to, details.label, details.strength, details.notes].join(' ').toLocaleLowerCase().includes(query)
    })
  }, [characterById, filter, relationships])
  const selected = relationships.find((relationship) => relationship.id === selectedId)
  const graph = useMemo(() => buildRelationshipGraph(characters, relationships), [characters, relationships])

  useEffect(() => {
    if (!creating && selectedId && !selected) setSelectedId(relationships[0]?.id ?? null)
    if (!creating && !selectedId && relationships.length) setSelectedId(relationships[0].id)
  }, [creating, relationships, selected, selectedId])

  useEffect(() => {
    setDraft(creating ? blankDraft(characters) : toDraft(selected, characters))
  }, [characters, creating, selected])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: keyof RelationshipDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function startNew() {
    setCreating(true)
    setSelectedId(null)
    setDraft(blankDraft(characters))
  }

  async function save() {
    if (!draft.fromId || !draft.toId || draft.fromId === draft.toId || !draft.label.trim()) return
    const from = characterById.get(draft.fromId)
    const to = characterById.get(draft.toId)
    if (!from || !to) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'relationship',
        id: creating ? null : selected?.id ?? null,
        title: relationshipTitle(from.title, to.title, draft.label),
        content: {
          fromId: draft.fromId,
          toId: draft.toId,
          label: draft.label.trim(),
          strength: draft.strength.trim(),
          notes: draft.notes,
        },
        tags: ['人物关系', draft.label.trim()],
      })
      const refreshed = useAppStore.getState().data?.entities ?? []
      const saved = creating
        ? refreshed.filter((entity) => entity.kind === 'relationship' && entity.title === relationshipTitle(from.title, to.title, draft.label)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
        : selected
      setCreating(false)
      setSelectedId(saved?.id ?? null)
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected || !window.confirm('将“' + selected.title + '”移入回收站？')) return
    try {
      await deleteEntity(selected.id)
      setSelectedId(null)
    } catch (error) {
      setError(error)
    }
  }

  function openRelationshipMenu(event: ReactMouseEvent<HTMLButtonElement>, item: EntityRecord) {
    const items: ContextMenuItem[] = [
      { type: 'item', id: 'relationship-open', label: '打开／编辑', onSelect: () => { setCreating(false); setSelectedId(item.id) } },
      { type: 'item', id: 'relationship-copy-title', label: '复制标题', onSelect: async () => { if (!await writeClipboardText(item.title)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'item', id: 'relationship-copy-path', label: '复制 Markdown 路径', onSelect: async () => { if (!await writeClipboardText(item.filePath)) setError('无法访问系统剪贴板，请改用 Ctrl+C。') } },
      { type: 'separator' },
      { type: 'item', id: 'relationship-trash', label: '移入回收站', icon: Trash2, tone: 'danger', onSelect: async () => { if (window.confirm('将“' + item.title + '”移入回收站？')) { await deleteEntity(item.id); if (selectedId === item.id) setSelectedId(null) } } },
    ]
    openContextMenu(event, { title: item.title, location: 'workspace', payload: { location: 'workspace', projectPath: currentProjectPath, entityId: item.id, entityKind: 'relationship' }, items, trigger: event.currentTarget })
  }

  if (!characters.length) {
    return <div className="workspace-view relationship-view"><div className="view-header"><div><p className="eyebrow">CHARACTER RELATIONSHIP MAP</p><h1>人物关系图</h1><p>先建立人物，再用关系图梳理角色之间的盟友、冲突和秘密。</p></div></div><Panel className="relationship-empty"><CircleUserRound size={30} /><strong>还没有人物资料</strong><span>人物关系图需要至少两个可连接的人物。</span><Button onClick={() => setView('character')}><Plus size={14} />建立人物</Button></Panel></div>
  }

  return <div className="workspace-view relationship-view">
    <div className="view-header"><div><p className="eyebrow">CHARACTER RELATIONSHIP MAP</p><h1>人物关系图</h1><p>用关系线查看人物网络；点击节点可以直接打开人物资料。</p></div><div className="special-summary"><strong>{characters.length}</strong><span>个人物 · {relationships.length} 条关系</span></div></div>
    <div className="special-toolbar"><div className="special-search"><Search size={14} /><TextInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索人物、关系类型或备注" /></div><Button onClick={startNew} disabled={characters.length < 2}><Plus size={14} />新建关系</Button></div>
    <Panel className="relationship-map-card"><div className="panel-title"><h3>关系网络</h3><span>按关系数量排列人物</span></div><div className="relationship-graph-scroll"><div className="relationship-graph-canvas" style={{ width: graph.width, height: graph.height }}><svg className="relationship-graph-svg" width={graph.width} height={graph.height} role="img" aria-label="人物关系网络"><g className="relationship-edges">{graph.links.map((link) => { const from = graph.nodes.find((node) => node.id === link.fromId); const to = graph.nodes.find((node) => node.id === link.toId); if (!from || !to) return null; const active = link.id === selectedId && !creating; const midX = (from.x + to.x) / 2; const midY = (from.y + to.y) / 2; return <g key={link.id} className={'relationship-edge' + (active ? ' active' : '')} onClick={() => { setCreating(false); setSelectedId(link.id) }}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} /><rect x={midX - 46} y={midY - 11} width="92" height="22" rx="5" /><text x={midX} y={midY + 4} textAnchor="middle">{link.label}</text></g> })}</g></svg><div className="relationship-node-layer">{graph.nodes.map((node) => <button key={node.id} type="button" className={'relationship-node' + (node.id === draft.fromId || node.id === draft.toId ? ' draft-node' : '')} style={{ left: node.x - 54, top: node.y - 29 }} onClick={() => selectEntity('character', node.id)} title={'打开人物资料：' + node.title}><CircleUserRound size={15} /><span>{node.title}</span><small>{node.degree} 条关系</small></button>)}</div></div></div></Panel>
    <div className="relationship-lower-layout"><aside className="relationship-list-pane"><div className="special-list-head"><div className="panel-title"><h3>关系清单</h3><span>{visibleRelationships.length} / {relationships.length}</span></div><p>点击关系线或清单查看详情。</p></div><div className="special-list">{visibleRelationships.length ? visibleRelationships.map((relationship) => { const details = relationshipDetails(relationship); const from = characterById.get(details.fromId)?.title ?? '未知人物'; const to = characterById.get(details.toId)?.title ?? '未知人物'; return <button key={relationship.id} type="button" className={'relationship-list-item' + (relationship.id === selectedId && !creating ? ' active' : '')} onClick={() => { setCreating(false); setSelectedId(relationship.id) }} onContextMenu={(event) => openRelationshipMenu(event, relationship)}><Link2 size={14} /><span><strong>{from} · {details.label || '关系'} · {to}</strong><small>{details.strength || '未标注强度'}{details.notes ? ' · ' + details.notes : ''}</small></span></button> }) : <div className="empty-state"><GitBranch size={24} /><div><strong>{filter ? '没有匹配关系' : '还没有关系记录'}</strong><span>{filter ? '换一个关键词试试。' : '点击“新建关系”连接两个人物。'}</span></div></div>}</div></aside><section className="special-editor"><Panel className="special-card">{creating || selected ? <><div className="planning-card-head"><div><p className="eyebrow">RELATIONSHIP DETAIL</p><h3>{creating ? '新建人物关系' : selected?.title}</h3></div><span className="planning-state">{busy ? '保存中…' : '本地资料'}</span></div><div className="planning-form"><div className="field-grid"><Field label="人物 A"><select className="select-input" value={draft.fromId} onChange={(event) => updateField('fromId', event.target.value)}>{characters.map((character) => <option key={character.id} value={character.id}>{character.title}</option>)}</select></Field><Field label="人物 B"><select className="select-input" value={draft.toId} onChange={(event) => updateField('toId', event.target.value)}>{characters.map((character) => <option key={character.id} value={character.id}>{character.title}</option>)}</select></Field></div><Field label="关系类型" hint="例如：盟友、亲属、敌对、师徒、暗恋"><TextInput autoFocus={creating} value={draft.label} onChange={(event) => updateField('label', event.target.value)} placeholder="填写两人的关系" /></Field><Field label="关系强度"><select className="select-input" value={draft.strength} onChange={(event) => updateField('strength', event.target.value)}><option>弱</option><option>普通</option><option>强</option><option>极强</option></select></Field><Field label="备注"><textarea className="text-area" value={draft.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="记录关系变化、秘密或需要在正文中兑现的细节…" /></Field>{draft.fromId === draft.toId ? <span className="field-hint relationship-error">人物 A 和人物 B 不能是同一个人。</span> : null}<div className="entity-actions"><Button onClick={() => void save()} disabled={busy || !draft.label.trim() || !draft.fromId || !draft.toId || draft.fromId === draft.toId}><Save size={14} />{busy ? '保存中…' : '保存关系'}</Button>{selected && !creating ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div></div></> : <div className="empty-state"><GitBranch size={25} /><div><strong>选择一条关系</strong><span>从图中点击关系线，或从左侧清单选择关系。</span></div></div>}</Panel></section></div>
  </div>
}
