import { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, Save, Search, Trash2 } from 'lucide-react'
import { ENTITY_FIELDS, ENTITY_LABELS } from '../lib/types'
import type { EntityDraft, EntityKind, SearchResult } from '../lib/types'
import { getObjectString } from '../lib/utils'
import { projectApi } from '../lib/api'
import { useAppStore } from '../stores/app-store'
import { Button, Field, TextInput } from './ui'

function blankDraft(kind: EntityKind): EntityDraft {
  return { title: '', tags: '', fields: Object.fromEntries(ENTITY_FIELDS[kind].map((field) => [field.key, ''])) }
}

function locationDepth(entity: { content: Record<string, unknown> }, locations: Array<{ id: string; content: Record<string, unknown> }>) {
  const byId = new Map(locations.map((item) => [item.id, item]))
  let depth = 0
  let parentId = locationParentId(entity)
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    depth += 1
    parentId = locationParentId(parent)
  }
  return depth
}

function locationParentId(entity: { content: Record<string, unknown> }) {
  const value = entity.content.parentId ?? entity.content.parent
  return typeof value === 'string' ? value : ''
}

function isLocationDescendant(candidateId: string, ancestorId: string, locations: Array<{ id: string; content: Record<string, unknown> }>) {
  const byId = new Map(locations.map((item) => [item.id, item]))
  let current = byId.get(candidateId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const parentId = locationParentId(current)
    if (!parentId) return false
    if (parentId === ancestorId) return true
    current = byId.get(parentId)
  }
  return false
}

function sortLocations<T extends { id: string; title: string; content: Record<string, unknown> }>(locations: T[]) {
  const byId = new Map(locations.map((location) => [location.id, location]))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const location of locations) {
    const parentId = locationParentId(location)
    if (parentId && byId.has(parentId)) {
      const siblings = children.get(parentId) ?? []
      siblings.push(location)
      children.set(parentId, siblings)
    } else {
      roots.push(location)
    }
  }
  const compare = (left: T, right: T) => left.title.localeCompare(right.title, 'zh-CN')
  roots.sort(compare)
  for (const siblings of children.values()) siblings.sort(compare)
  const result: T[] = []
  const visiting = new Set<string>()
  const visit = (location: T) => {
    if (visiting.has(location.id)) return
    visiting.add(location.id)
    result.push(location)
    for (const child of children.get(location.id) ?? []) visit(child)
    visiting.delete(location.id)
  }
  roots.forEach(visit)
  locations.filter((location) => !result.some((item) => item.id === location.id)).sort(compare).forEach(visit)
  return result
}

export function EntityView({ kind }: { kind: EntityKind }) {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const selectedEntityId = useAppStore((state) => state.selectedEntityId)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const setError = useAppStore((state) => state.setError)
  const [draft, setDraft] = useState<EntityDraft>(() => blankDraft(kind))
  const [filter, setFilter] = useState('')
  const [sortMode, setSortMode] = useState<'created' | 'title' | 'updated'>('created')
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([])
  const [busy, setBusy] = useState(false)
  const [references, setReferences] = useState<SearchResult[]>([])
  const [referencesBusy, setReferencesBusy] = useState(false)
  const entities = useMemo(() => data?.entities.filter((entity) => entity.kind === kind) ?? [], [data?.entities, kind])
  const selected = entities.find((entity) => entity.id === selectedEntityId)
  const locationEntities = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'location'), [data?.entities])

  useEffect(() => {
    let cancelled = false
    if (!projectPath || !selected || selected.kind === 'attachment') {
      setReferences([])
      setReferencesBusy(false)
      return () => { cancelled = true }
    }
    setReferencesBusy(true)
    void projectApi.search({
      projectPath,
      query: '[[' + selected.title + ']]',
      kind: 'manuscript',
      scope: 'project',
    }).then((results) => {
      if (!cancelled) setReferences(results.filter((result) => result.kind === 'chapter' || result.kind === 'section'))
    }).catch(() => {
      if (!cancelled) setReferences([])
    }).finally(() => {
      if (!cancelled) setReferencesBusy(false)
    })
    return () => { cancelled = true }
  }, [projectPath, selected])

  useEffect(() => {
    const next = blankDraft(kind)
    if (selected) {
      next.title = selected.title
      next.tags = selected.tags.join(', ')
      for (const field of ENTITY_FIELDS[kind]) {
        next.fields[field.key] = field.key === 'parentId'
          ? getObjectString(selected.content.parentId ?? selected.content.parent)
          : getObjectString(selected.content[field.key])
      }
    }
    setDraft(next)
    const builtInKeys = new Set(ENTITY_FIELDS[kind].map((field) => field.key))
    if (kind === 'location') builtInKeys.add('parent')
    setCustomFields(selected
      ? Object.entries(selected.content)
        .filter(([key]) => !builtInKeys.has(key))
        .map(([key, value]) => ({ key, value: getObjectString(value) }))
      : [])
  }, [kind, selectedEntityId, selected])

  const visibleEntities = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    const filtered = query ? entities.filter((entity) => (entity.title + entity.tags.join(' ')).toLocaleLowerCase().includes(query)) : entities
    const sorted = filtered.slice()
    if (kind === 'location' && sortMode === 'created') {
      return sortLocations(sorted)
    } else if (sortMode === 'title') {
      sorted.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
    } else if (sortMode === 'updated') {
      sorted.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    }
    return sorted
  }, [entities, filter, kind, sortMode])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: string, value: string) {
    setDraft((current) => ({ ...current, fields: { ...current.fields, [key]: value } }))
  }

  function updateCustomField(index: number, key: 'key' | 'value', value: string) {
    setCustomFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]: value } : field))
  }

  async function submit() {
    if (!draft.title.trim()) return
    setBusy(true)
    try {
      const fixedKeys = new Set(ENTITY_FIELDS[kind].map((field) => field.key))
      const customContent = Object.fromEntries(customFields
        .map((field) => ({ key: field.key.trim(), value: field.value }))
        .filter((field) => field.key && !fixedKeys.has(field.key) && !(kind === 'location' && field.key === 'parent') && field.value.trim() !== '')
        .map((field) => [field.key, field.value]))
      await saveEntity({
        projectPath: currentProjectPath, kind, id: selected?.id ?? null, title: draft.title.trim(),
        content: {
          ...Object.fromEntries(Object.entries(draft.fields).filter(([, value]) => value.trim() !== '')),
          ...customContent,
        },
        tags: draft.tags.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean),
      })
      selectEntity(kind, selected?.id ?? null)
    } catch (error) { setError(error) } finally { setBusy(false) }
  }

  async function remove() {
    if (!selected || !window.confirm('将“' + selected.title + '”移入回收站？')) return
    await deleteEntity(selected.id)
  }

  return <div className="entity-view">
    <div className="entity-layout">
      <aside className="entity-list-pane">
        <div className="entity-list-head"><div className="panel-title"><h2>{ENTITY_LABELS[kind]}</h2><Button onClick={() => selectEntity(kind, null)}><Plus size={14} />新建</Button></div><div className="entity-filter"><Search size={14} color="var(--faint)" style={{ marginTop: 8, flex: '0 0 auto' }} /><TextInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={'搜索' + ENTITY_LABELS[kind]} /></div><select className="select-input entity-sort" value={sortMode} onChange={(event) => setSortMode(event.target.value as 'created' | 'title' | 'updated')} aria-label="资料排序"><option value="created">默认顺序</option><option value="title">按名称</option><option value="updated">按最近更新</option></select></div>
        <div className="entity-list">{visibleEntities.length ? visibleEntities.map((entity) => <button className={'entity-list-item' + (entity.id === selectedEntityId ? ' active' : '')} style={kind === 'location' ? { paddingLeft: String(10 + locationDepth(entity, locationEntities) * 16) + 'px' } : undefined} key={entity.id} onClick={() => selectEntity(kind, entity.id)}><strong>{entity.title}</strong><span>{entity.tags.length ? entity.tags.join(' · ') : '未添加标签'}</span></button>) : <div className="tree-muted">还没有{ENTITY_LABELS[kind]}，点击“新建”开始建立资料。</div>}</div>
      </aside>
      <section className="entity-editor">
        {selected || selectedEntityId === null ? <><div className="entity-editor-header"><div><p className="eyebrow">{ENTITY_LABELS[kind].toUpperCase()} ARCHIVE</p><h1>{selected ? selected.title : '新建' + ENTITY_LABELS[kind]}</h1><p>{selected ? '资料会同时保存为项目目录中的 Markdown 镜像，并进入 SQLite 搜索索引。' : '字段可以随时补充；先保存一个名字也可以。'}</p></div><div className="view-actions">{selected ? <Button variant="outline" onClick={() => void navigator.clipboard?.writeText('[[' + selected.title + ']]')}><Copy size={14} />复制 Wiki 链接</Button> : null}</div></div>
          <div className="entity-form"><Field label="名称"><TextInput autoFocus={!selected} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={'输入' + ENTITY_LABELS[kind] + '名称'} /></Field><Field label="标签" hint="使用逗号分隔，例如：主角、北境、待确认"><TextInput value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="添加标签" /></Field>{ENTITY_FIELDS[kind].map((field) => <Field key={field.key} label={field.label}>{kind === 'location' && field.key === 'parentId' ? <select className="select-input" value={draft.fields[field.key] ?? ''} onChange={(event) => updateField(field.key, event.target.value)}><option value="">无（顶层地点）</option>{locationEntities.filter((location) => location.id !== selected?.id && !isLocationDescendant(location.id, selected?.id ?? '', locationEntities)).sort((left, right) => locationDepth(left, locationEntities) - locationDepth(right, locationEntities) || left.title.localeCompare(right.title, 'zh-CN')).map((location) => <option key={location.id} value={location.id}>{'　'.repeat(locationDepth(location, locationEntities)) + location.title}</option>)}</select> : field.multiline ? <textarea className="text-area" value={draft.fields[field.key] ?? ''} onChange={(event) => updateField(field.key, event.target.value)} placeholder={'记录' + field.label + '…'} /> : <TextInput value={draft.fields[field.key] ?? ''} onChange={(event) => updateField(field.key, event.target.value)} placeholder={'填写' + field.label} />}</Field>)}<div className="custom-fields-panel"><div className="panel-title"><h3>自定义字段</h3><Button variant="ghost" onClick={() => setCustomFields((current) => [...current, { key: '', value: '' }])}><Plus size={13} />添加字段</Button></div>{customFields.map((field, index) => <div className="custom-field-row" key={String(index)}><TextInput value={field.key} onChange={(event) => updateCustomField(index, 'key', event.target.value)} placeholder="字段名" aria-label="自定义字段名" /><TextInput value={field.value} onChange={(event) => updateCustomField(index, 'value', event.target.value)} placeholder="字段值" aria-label="自定义字段值" /><Button variant="ghost" onClick={() => setCustomFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))} aria-label="删除自定义字段">×</Button></div>)}<span className="field-hint">可添加专用字段之外的设定；字段名不能覆盖内置字段。</span></div>{selected && kind !== 'attachment' ? <div className="entity-reference-panel"><div className="panel-title"><h3>正文反向引用</h3><span>{referencesBusy ? '查询中…' : references.length + ' 个章节'}</span></div>{references.length ? <div className="planning-reference-list">{references.map((reference) => <button type="button" key={reference.id} className="planning-reference" onClick={() => void useAppStore.getState().selectNode(reference.id)}><span>{reference.title}</span></button>)}</div> : <span className="planning-reference-empty">{referencesBusy ? '正在查找引用该条目的章节…' : '还没有发现 [[条目名称]] 形式的正文引用。'}</span>}</div> : null}<div className="entity-actions"><Button onClick={() => void submit()} disabled={busy || !draft.title.trim()}><Save size={15} />{busy ? '保存中…' : '保存资料'}</Button>{selected ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div></div></> : <div className="empty-state"><p>从左侧选择一个条目。</p></div>}
      </section>
    </div>
  </div>
}
