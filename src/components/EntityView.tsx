import { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, Save, Search, Trash2 } from 'lucide-react'
import { ENTITY_FIELDS, ENTITY_LABELS } from '../lib/types'
import type { EntityDraft, EntityKind } from '../lib/types'
import { getObjectString } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import { Button, Field, TextInput } from './ui'

function blankDraft(kind: EntityKind): EntityDraft {
  return { title: '', tags: '', fields: Object.fromEntries(ENTITY_FIELDS[kind].map((field) => [field.key, ''])) }
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
  const [busy, setBusy] = useState(false)
  const entities = useMemo(() => data?.entities.filter((entity) => entity.kind === kind) ?? [], [data?.entities, kind])
  const selected = entities.find((entity) => entity.id === selectedEntityId)

  useEffect(() => {
    const next = blankDraft(kind)
    if (selected) {
      next.title = selected.title
      next.tags = selected.tags.join(', ')
      for (const field of ENTITY_FIELDS[kind]) next.fields[field.key] = getObjectString(selected.content[field.key])
    }
    setDraft(next)
  }, [kind, selectedEntityId, selected])

  const visibleEntities = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return query ? entities.filter((entity) => (entity.title + entity.tags.join(' ')).toLocaleLowerCase().includes(query)) : entities
  }, [entities, filter])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: string, value: string) {
    setDraft((current) => ({ ...current, fields: { ...current.fields, [key]: value } }))
  }

  async function submit() {
    if (!draft.title.trim()) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath, kind, id: selected?.id ?? null, title: draft.title.trim(),
        content: Object.fromEntries(Object.entries(draft.fields).filter(([, value]) => value.trim() !== '')),
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
        <div className="entity-list-head"><div className="panel-title"><h2>{ENTITY_LABELS[kind]}</h2><Button onClick={() => selectEntity(kind, null)}><Plus size={14} />新建</Button></div><div className="entity-filter"><Search size={14} color="var(--faint)" style={{ marginTop: 8, flex: '0 0 auto' }} /><TextInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={'搜索' + ENTITY_LABELS[kind]} /></div></div>
        <div className="entity-list">{visibleEntities.length ? visibleEntities.map((entity) => <button className={'entity-list-item' + (entity.id === selectedEntityId ? ' active' : '')} key={entity.id} onClick={() => selectEntity(kind, entity.id)}><strong>{entity.title}</strong><span>{entity.tags.length ? entity.tags.join(' · ') : '未添加标签'}</span></button>) : <div className="tree-muted">还没有{ENTITY_LABELS[kind]}，点击“新建”开始建立资料。</div>}</div>
      </aside>
      <section className="entity-editor">
        {selected || selectedEntityId === null ? <><div className="entity-editor-header"><div><p className="eyebrow">{ENTITY_LABELS[kind].toUpperCase()} ARCHIVE</p><h1>{selected ? selected.title : '新建' + ENTITY_LABELS[kind]}</h1><p>{selected ? '资料会同时保存为项目目录中的 Markdown 镜像，并进入 SQLite 搜索索引。' : '字段可以随时补充；先保存一个名字也可以。'}</p></div><div className="view-actions">{selected ? <Button variant="outline" onClick={() => void navigator.clipboard?.writeText('[[' + selected.title + ']]')}><Copy size={14} />复制 Wiki 链接</Button> : null}</div></div>
          <div className="entity-form"><Field label="名称"><TextInput autoFocus={!selected} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={'输入' + ENTITY_LABELS[kind] + '名称'} /></Field><Field label="标签" hint="使用逗号分隔，例如：主角、北境、待确认"><TextInput value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="添加标签" /></Field>{ENTITY_FIELDS[kind].map((field) => <Field key={field.key} label={field.label}>{field.multiline ? <textarea className="text-area" value={draft.fields[field.key] ?? ''} onChange={(event) => updateField(field.key, event.target.value)} placeholder={'记录' + field.label + '…'} /> : <TextInput value={draft.fields[field.key] ?? ''} onChange={(event) => updateField(field.key, event.target.value)} placeholder={'填写' + field.label} />}</Field>)}<div className="entity-actions"><Button onClick={() => void submit()} disabled={busy || !draft.title.trim()}><Save size={15} />{busy ? '保存中…' : '保存资料'}</Button>{selected ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div></div></> : <div className="empty-state"><p>从左侧选择一个条目。</p></div>}
      </section>
    </div>
  </div>
}
