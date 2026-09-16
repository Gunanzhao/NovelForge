import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../lib/api'
import { busyDrafts, dirtyDrafts } from '../lib/draft-guard'
import { entityState, stableValue } from '../lib/entity-history'
import { planWikiRename, selectedWikiRenameChanges, type WikiRenameOperation, type WikiRenamePlan } from '../lib/wiki-rename'
import type { EntityRecord } from '../lib/types'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, Field, TextInput } from './ui'

export function WikiRenamePanel({ entity, projectPath, blocked = false, onBusyChange }: { entity: EntityRecord; projectPath: string; blocked?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [open,setOpen] = useState(false)
  const [title,setTitle] = useState('')
  const [alias,setAlias] = useState(true)
  const [plan,setPlan] = useState<WikiRenamePlan | null>(null)
  const [selected,setSelected] = useState<string[]>([])
  const [operations,setOperations] = useState<WikiRenameOperation[]>([])
  const [undoId,setUndoId] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [attempt,setAttempt] = useState(0)
  const generation = useRef(0), pending = useRef(false)
  const fingerprint = stableValue(entityState(entity))
  const documentUnsafe = useAppStore(state => state.saveState === 'saving' || Boolean(state.document && state.document.content !== state.document.persistedContent))
  const unavailable = blocked || documentUnsafe
  useEffect(() => {
    const request = ++generation.current
    setPlan(null);setSelected([]);setTitle('');setUndoId('');setOperations([]);setError('')
    if (open) void projectApi.listWikiRenames({projectPath,targetId:entity.id}).then(operations => {
      if (generation.current === request) setOperations(operations)
    }).catch(error => {if (generation.current === request) setError(String(error))})
    return () => {generation.current = request+1}
  },[projectPath,entity.id,fingerprint,open,attempt])

  async function run(mode: 'preview' | 'apply' | 'undo') {
    if (pending.current || unavailable || busyDrafts() || dirtyDrafts().length) return
    const session = captureProjectSession(), initial = useAppStore.getState()
    if (session.path !== projectPath || !initial.data) return
    const request = generation.current
    const current = () => generation.current === request && isCurrentProjectSession(session)
    pending.current = true;setBusy(true);onBusyChange?.(true);setError('');setNotice('')
    try {
      if (mode === 'preview') {
        const snapshot = structuredClone(initial.data)
        const documents: Record<string,string> = {}
        // Bound parallel reads for large projects; every chapter must be readable.
        const nodes = snapshot.nodes.filter(node => node.kind !== 'volume')
        for (let offset=0; offset<nodes.length; offset+=8) {
          const entries = await Promise.all(nodes.slice(offset,offset+8).map(async node => [node.id,(await projectApi.getDocument({projectPath,nodeId:node.id})).content] as const))
          if (!current()) return
          for (const [id,content] of entries) documents[id] = content
        }
        const preview = planWikiRename(snapshot,documents,entity.id,title,alias)
        if (!current()) return
        setPlan(preview);setSelected(preview.ambiguous ? [] : preview.references.map(reference => reference.id))
      } else {
        if (mode === 'apply' && !plan || mode === 'undo' && !undoId) return
        const result = mode === 'apply'
          ? await projectApi.applyWikiRename({projectPath,targetId:entity.id,changes:selectedWikiRenameChanges(plan!,selected)})
          : await projectApi.undoWikiRename({projectPath,operationId:undoId})
        if (!current()) return
        // Read the current body before updating the store, preserving the archive
        // view and replacing only the untouched, saved document cache.
        const before = useAppStore.getState()
        let reloadError = ''
        const document = before.document ? await projectApi.getDocument({projectPath,nodeId:before.document.node.id}).catch(error => {reloadError = String(error);return null}) : null
        if (!current()) return
        await useAppStore.getState().refreshData(result.data,true,session)
        if (!isCurrentProjectSession(session)) return
        if (document) useAppStore.setState(state => state.documentVersion === before.documentVersion && state.document?.node.id === document.node.id && state.document.content === before.document?.content
          ? {document:{...document,persistedContent:document.content},documentVersion:state.documentVersion+1,editorSelection:null,saveState:'saved'}
          : {error:'EXTERNAL_CONFLICT:批量操作已完成，当前正文缓存有新修改，请重新核对磁盘正文。'})
        if (reloadError) useAppStore.setState({saveState:'error',error:'EXTERNAL_CONFLICT:改名操作已保存，但正文刷新失败，请重新读取磁盘正文：'+reloadError})
        setNotice(reloadError ? '操作已保存，但正文刷新失败；请重新读取正文。仍可从操作记录检查本次改名。' : mode === 'apply' ? '改名已完成，原内容已保留。可在下方撤销整次操作。' : '已撤销整次改名，撤销前内容也已保留。')
        setAttempt(value => value+1)
      }
    } catch (error) { if (current()) {setError(String(error));if (mode !== 'preview') setPlan(null)} }
    finally {pending.current=false;onBusyChange?.(false);if (isCurrentProjectSession(session)) setBusy(false)}
  }
  const invalidate = () => {setPlan(null);setSelected([]);setError('');setNotice('')}
  return <section className="entity-history-panel wiki-rename-panel" aria-label="Wiki安全改名">
    <Button variant="outline" disabled={busy} aria-expanded={open} onClick={() => setOpen(value => !value)}>Wiki安全改名</Button>
    {open && <div className="entity-history-body">
      <p className="field-hint">预览正文和规划资料中的明确引用，按位置选择更新。普通同名文字只供检查；代码、元数据等内容保留原样。</p>
      {unavailable && <p role="status">请先保存或放弃当前资料及正文修改，再预览或执行改名。</p>}
      <Field label="新资料名称"><TextInput disabled={busy} value={title} onChange={event => {setTitle(event.target.value);invalidate()}} placeholder={entity.title} /></Field>
      <label className="entity-history-field"><input type="checkbox" disabled={busy} checked={alias} onChange={event => {setAlias(event.target.checked);invalidate()}} />将旧名称保留为别名</label>
      <Button variant="outline" disabled={busy || unavailable || !title.trim()} onClick={() => void run('preview')}>{busy ? '处理中…' : '预览改名影响'}</Button>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {plan && <div className="wiki-rename-preview">
        <p><strong>{plan.entity.title} → {plan.newTitle}</strong> · 已选 {selected.length} / {plan.references.length} 处明确引用</p>
        {plan.ambiguous && <p role="alert">原名称对应多条资料，无法确定引用归属。本次只能修改资料名称，引用保持原样。</p>}
        <div className="entity-actions"><Button variant="outline" disabled={busy || plan.ambiguous} onClick={() => setSelected(plan.references.map(reference => reference.id))}>全选引用</Button><Button variant="outline" disabled={busy} onClick={() => setSelected([])}>清空选择</Button></div>
        <div className="wiki-rename-references">{plan.references.length ? plan.references.map((reference,index) => <label key={reference.id} className="wiki-rename-reference"><input type="checkbox" aria-label={'更新引用 '+(index+1)+'：'+reference.title} disabled={busy || plan.ambiguous} checked={selected.includes(reference.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids,reference.id] : ids.filter(id => id!==reference.id))} /><span><strong>{reference.title}</strong><small>{reference.refKind === 'node' ? '正文' : '资料 · '+reference.fieldPath.join(' / ')}</small><pre>{reference.excerpt}</pre></span></label>) : <p>没有需要更新的明确引用；仅修改资料名称和所选别名。</p>}</div>
        <details><summary>普通文字候选（{plan.plainCandidates.length}处，不自动修改）</summary>{plan.plainCandidates.map(reference => <div className="wiki-rename-candidate" key={reference.id}><strong>{reference.title}</strong><pre>{reference.excerpt}</pre></div>)}</details>
        <Button disabled={busy || unavailable} onClick={() => void run('apply')}>确认改名并更新所选引用</Button>
      </div>}
      {operations.length > 0 && <div className="wiki-rename-undo"><Field label="改名操作记录"><select className="select-input" disabled={busy} value={undoId} onChange={event => setUndoId(event.target.value)}><option value="">选择要撤销的整次操作</option>{operations.map(operation => <option key={operation.id} value={operation.id} disabled={Boolean(operation.undoneBy)}>{new Date(operation.createdAt).toLocaleString()} · {operation.label}{operation.undoneBy ? '（已撤销）' : ''}</option>)}</select></Field><p className="field-hint">撤销会恢复这次操作涉及的全部正文和资料。若存在后续编辑，将停止撤销并保留新内容。</p><Button variant="outline" disabled={busy || unavailable || !undoId} onClick={() => void run('undo')}>撤销整次改名</Button></div>}
    </div>}
  </section>
}
