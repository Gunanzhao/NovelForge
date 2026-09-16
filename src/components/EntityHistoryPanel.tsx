import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../lib/api'
import { entityState, entityVersionChanges, stableValue } from '../lib/entity-history'
import { ENTITY_FIELDS, type EntityRecord, type EntityVersion } from '../lib/types'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, Field, TextInput } from './ui'

function display(value: unknown) { return value === undefined ? '（无此字段）' : typeof value === 'string' ? value || '（空）' : JSON.stringify(value, null, 2) }

export function EntityHistoryPanel({ entity, projectPath, blocked = false, onBusyChange }: { entity: EntityRecord; projectPath: string; blocked?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<EntityVersion[]>([])
  const [selected, setSelected] = useState<string>('')
  const [fields, setFields] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const pending = useRef(false)
  const current = entityState(entity)
  const fingerprint = stableValue(current)
  const version = versions.find(version => version.id === selected)
  const changes = version ? entityVersionChanges(current, version) : []
  const labels = new Map(ENTITY_FIELDS[entity.kind].map(field => ['content.' + field.key, field.label]))
  const label = (key: string) => key === 'title' ? '名称' : key === 'tags' ? '标签' : labels.get(key) ?? key.slice(8)

  useEffect(() => {
    const request = ++generation.current
    setVersions([]); setSelected(''); setFields(new Set()); setError(''); setBusy(false)
    if (!open) { setLoading(false); return }
    setLoading(true)
    void projectApi.listEntityHistory({ projectPath, entityId: entity.id }).then(items => {
      if (generation.current !== request) return
      setVersions(items); setMore(items.length === 50)
    }).catch(error => { if (generation.current === request) setError(String(error)) })
      .finally(() => { if (generation.current === request) setLoading(false) })
    return () => { generation.current = request + 1 }
  }, [projectPath, entity.id, fingerprint, open, attempt])

  async function loadMore() {
    if (loading || !more) return
    const request = generation.current
    setLoading(true); setError('')
    try {
      const items = await projectApi.listEntityHistory({ projectPath, entityId: entity.id, beforeId: versions.at(-1)?.id })
      if (generation.current !== request) return
      setVersions(previous => [...previous, ...items.filter(item => !previous.some(old => old.id === item.id))]); setMore(items.length === 50)
    } catch (error) { if (generation.current === request) setError(String(error)) }
    finally { if (generation.current === request) setLoading(false) }
  }

  async function action(mode: 'name' | 'all' | 'fields') {
    if (pending.current || blocked || loading || (mode !== 'name' && !version)) return
    const session = captureProjectSession()
    if (session.path !== projectPath) return
    const request = generation.current
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      if (mode === 'name') {
        await projectApi.nameEntityVersion({ projectPath, entityId: entity.id, name, expected: current })
      } else {
        const data = await projectApi.restoreEntityVersion({ projectPath, entityId: entity.id, versionId: version!.id, expected: current, ...(mode === 'fields' ? { fields: [...fields] } : {}) })
        if (generation.current !== request || !isCurrentProjectSession(session)) return
        await useAppStore.getState().refreshData(data, true, session)
      }
      if (generation.current === request && isCurrentProjectSession(session)) { setName(''); setAttempt(value => value + 1) }
    } catch (error) { if (generation.current === request && isCurrentProjectSession(session)) setError(String(error)) }
    finally { pending.current = false; onBusyChange?.(false); if (generation.current === request) setBusy(false) }
  }

  return <section className="entity-history-panel" aria-label="资料版本历史">
    <Button variant="outline" disabled={busy} onClick={() => setOpen(value => !value)} aria-expanded={open}>资料版本历史</Button>
    {open && <div className="entity-history-body">
      <p className="field-hint">比较当前已保存资料与历史版本；恢复前的内容会保留在历史中。{entity.kind === 'attachment' ? '附件历史记录说明与关联，不复制原文件。' : ''}</p>
      {blocked && <p role="status">请先保存或放弃当前修改，再命名或恢复版本。</p>}
      <Field label="版本名称"><div className="input-with-action"><TextInput maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：第一卷定稿设定" /><Button disabled={busy || blocked || loading || !name.trim()} onClick={() => void action('name')}>保存命名版本</Button></div></Field>
      {error && <div role="alert">{error}<Button variant="outline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>重新加载</Button></div>}
      <Field label="历史版本"><select className="select-input" value={selected} disabled={busy || loading} onChange={event => { setSelected(event.target.value); setFields(new Set()) }}><option value="">选择版本进行比较</option>{versions.map(version => <option key={version.id} value={version.id}>{new Date(version.createdAt).toLocaleString()} · {version.label}</option>)}</select></Field>
      {loading ? <p role="status">读取历史中…</p> : versions.length === 0 && !error ? <p>尚无资料历史；保存资料或创建命名版本后会显示在这里。</p> : null}
      {more && <Button variant="outline" disabled={loading || busy} onClick={() => void loadMore()}>加载更早版本</Button>}
      {version && <>
        <p>左侧为当前已保存值，右侧为所选历史值。</p>
        {changes.length ? <div className="entity-history-differences">{changes.map(change => <div className="entity-history-change" key={change.key}>
          <label className="entity-history-field"><input type="checkbox" checked={fields.has(change.key)} disabled={busy || blocked} onChange={() => setFields(current => { const next = new Set(current); if (next.has(change.key)) next.delete(change.key); else next.add(change.key); return next })} />{label(change.key)}</label>
          <div className="entity-history-values"><pre aria-label={label(change.key) + '当前值'}>{display(change.current)}</pre><pre aria-label={label(change.key) + '历史值'}>{display(change.previous)}</pre></div>
        </div>)}</div> : <p>此版本与当前已保存资料相同。</p>}
        <div className="entity-actions"><Button disabled={busy || blocked || !fields.size} onClick={() => void action('fields')}>恢复所选字段</Button><Button variant="outline" disabled={busy || blocked || !changes.length} onClick={() => void action('all')}>恢复整个版本</Button></div>
      </>}
    </div>}
  </section>
}
