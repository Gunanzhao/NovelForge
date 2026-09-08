import { create } from 'zustand'
import { ChangeSet, type ChangeDesc } from '@codemirror/state'
import { isDesktop, projectApi } from '../lib/api'
import { codexApi } from '../lib/codex'
import { estimateContextBudget, type AiPreferences } from '../lib/ai-data'
import { aiEdits, applyAiEdits, mapAiRange, textChanges, type AiEdit, type AiRange } from '../lib/ai-edit'
import { isNodeLocked } from '../lib/node-lock'
import type { AiCompletionResult } from '../lib/types'
import { useAppStore } from './app-store'
import { useCodexSession } from './codex-session'

export interface AiTarget extends AiRange {
  project: string
  session: number
  node: string
  title: string
  kind: 'selection' | 'cursor' | 'chapter'
  originalFrom: number
  originalText: string
  originalContent: string
}
export interface AiRequest {
  preferences: AiPreferences
  apiKey: string
  systemPrompt: string
  prompt: string
  local: AiCompletionResult
}
interface AiTask {
  id: string | null
  phase: 'idle' | 'preparing' | 'running' | 'complete' | 'cancelled' | 'failed'
  result: AiCompletionResult | null
  error: string
  target: AiTarget | null
  source: string
  mapping: ChangeDesc | null
  edits: AiEdit[]
  application: 'rewrite' | 'generate' | 'analyze'
  transport: 'offline' | 'provider' | 'codex'
  start: (target: AiTarget, application: AiTask['application'], prepare: () => Promise<AiRequest>) => Promise<void>
  stop: () => void
  clear: () => void
  editResult: (content: string) => void
  observe: (before: string, after: string, changes?: ChangeSet) => void
  accept: (id?: string) => void
  reject: (id: string) => void
  insert: (position: 'target' | 'after' | 'end') => void
}

export function captureAiTarget(kind: AiTarget['kind'], range?: { from: number; to: number }): AiTarget {
  const state = useAppStore.getState(), doc = state.document
  if (!state.projectPath || !doc) throw new Error('请先打开一个章节。')
  const selection = state.editorSelection?.nodeId === doc.node.id ? state.editorSelection : null
  const from = kind === 'chapter' ? 0 : range?.from ?? selection?.from ?? doc.content.length
  const to = kind === 'chapter' ? doc.content.length : kind === 'cursor' ? from : range?.to ?? selection?.to ?? from
  if (from < 0 || to < from || to > doc.content.length || (kind === 'selection' && from === to)) throw new Error('请先选择要处理的正文。')
  return { project: state.projectPath, session: state.projectSession, node: doc.node.id, title: doc.node.title, kind,
    from, to, conflict: false, originalFrom: from, originalText: doc.content.slice(from, to), originalContent: doc.content }
}
function isCurrent(target: AiTarget) {
  const state = useAppStore.getState()
  return state.projectPath === target.project && state.projectSession === target.session && state.document?.node.id === target.node
}

// The editor registers a transactional writer, so accepting AI edits has one undo boundary.
let editorWriter: { target: Pick<AiTarget, 'project' | 'session' | 'node'>; write: (source: string, changes: ChangeSet) => boolean } | null = null
export function registerAiEditor(target: Pick<AiTarget, 'project' | 'session' | 'node'>, write: (source: string, changes: ChangeSet) => boolean) {
  const entry = { target, write }; editorWriter = entry
  return () => { if (editorWriter === entry) editorWriter = null }
}
function writeChanges(target: AiTarget, source: string, content: string, changes: ChangeSet) {
  if (!isCurrent(target) || isNodeLocked(useAppStore.getState().data?.nodes ?? [], target.node)) throw new Error('目标章节已切换或锁定，无法应用结果。')
  if (editorWriter && editorWriter.target.project === target.project && editorWriter.target.session === target.session && editorWriter.target.node === target.node) {
    if (!editorWriter.write(source, changes)) throw new Error('编辑器正文已变化，未应用结果。')
  } else {
    if (useAppStore.getState().document?.content !== source) throw new Error('目标正文已变化，未应用结果。')
    useAppStore.getState().updateContent(content)
  }
  if (useAppStore.getState().document?.content !== content) throw new Error('正文未完成更新，请重新检查。')
}

export const useAiTask = create<AiTask>((set, get) => ({
  id: null, phase: 'idle', result: null, error: '', target: null, source: '', mapping: null, edits: [], application: 'generate', transport: 'offline',
  async start(target, application, prepare) {
    if (get().id) return
    const id = crypto.randomUUID()
    set({ id, phase: 'preparing', result: null, error: '', target, source: target.originalContent, mapping: ChangeSet.empty(target.originalContent.length).desc, edits: [], application, transport: 'offline' })
    const valid = () => get().id === id && isCurrent(target)
    try {
      const request = await prepare()
      if (!valid()) return
      const { preferences: prefs, apiKey, systemPrompt, prompt, local } = request
      if (estimateContextBudget([{ title: 'System', kind: 'system', content: systemPrompt }, { title: 'User', kind: 'user', content: prompt }]).overLimit) throw new Error('System 与 User Prompt 总和超过安全阈值，请减少内容。')
      const transport = prefs.mode === 'codex' ? 'codex' : prefs.mode === 'offline' || !prefs.endpoint.trim() || prefs.endpoint.trim().toLowerCase() === 'local' || !isDesktop ? 'offline' : 'provider'
      set({ transport, phase: 'running' })
      let result: AiCompletionResult
      if (transport === 'codex') {
        if (!isDesktop) throw new Error('Codex 接入需要 NovelForge 桌面版。')
        set({ result: { content: '', model: prefs.codexModel ?? '' } })
        result = await codexApi.generate({ cliPath: prefs.codexPath ?? '', requestId: id, model: prefs.codexModel ?? '', effort: prefs.codexEffort ?? 'low', systemPrompt, prompt }, delta => {
          if (valid()) set(state => ({ result: { content: (state.result?.content ?? '') + delta, model: prefs.codexModel ?? '' } }))
        }, () => !valid())
      } else if (transport === 'provider') {
        result = await projectApi.aiComplete({ endpoint: prefs.endpoint, model: prefs.model, apiKey, systemPrompt, prompt, temperature: prefs.temperature ?? 0.7, maxTokens: prefs.maxTokens ?? 4000 })
      } else result = local
      if (!valid()) return
      const mapping = get().mapping!
      const edits = application === 'rewrite' ? aiEdits(target.originalText, result.content, target.originalFrom).map(edit => ({ ...edit, ...mapAiRange(edit, mapping) })) : []
      set({ result, edits, phase: 'complete', id: null })
    } catch (error) {
      if (!valid()) return
      if (get().transport === 'codex') useCodexSession.getState().invalidate('生成连接未通过，请重新检查连接。')
      set({ phase: 'failed', id: null, error: String(error) })
      useAppStore.getState().setError(error)
    } finally { if (get().id === id) set({ id: null, phase: 'cancelled' }) }
  },
  stop() {
    const { id, transport } = get()
    if (!id) return
    set({ id: null, phase: 'cancelled', error: '' })
    if (transport === 'codex') void codexApi.cancel(id).catch(error => useAppStore.getState().setError(error))
  },
  clear() {
    get().stop()
    set({ phase: 'idle', target: null, result: null, edits: [], source: '', mapping: null, error: '' })
  },
  editResult(content) {
    const { result, target, mapping, edits, phase, application } = get()
    if (!result || !target || !mapping || phase !== 'complete' || edits.some(edit => edit.state === 'accepted')) return
    set({ result: { ...result, content }, edits: application === 'rewrite' ? aiEdits(target.originalText, content, target.originalFrom).map(edit => ({ ...edit, ...mapAiRange(edit, mapping) })) : [] })
  },
  observe(before, after, knownChanges) {
    const { target, source, mapping, edits } = get()
    if (!target || !mapping || !isCurrent(target) || source === after) return
    const changes = source === before && knownChanges ? knownChanges : textChanges(source, after)
    set({ source: after, mapping: mapping.composeDesc(changes.desc), target: { ...target, ...mapAiRange(target, changes) }, edits: edits.map(edit => edit.state === 'pending' ? { ...edit, ...mapAiRange(edit, changes) } : edit) })
  },
  accept(id) {
    const { target, source, edits, phase } = get()
    if (!target || phase !== 'complete') return
    try {
      const selected = edits.filter(edit => edit.state === 'pending' && (id === undefined || edit.id === id))
      if (!selected.length) return
      const { content, changes } = applyAiEdits(source, selected)
      // Mark accepted before the editor transaction maps the remaining pending hunks.
      set({ edits: edits.map(edit => selected.includes(edit) ? { ...edit, state: 'accepted' } : edit), error: '' })
      try { writeChanges(target, source, content, changes) }
      catch (error) { set({ edits }); throw error }
    } catch (error) { set({ error: String(error) }); useAppStore.getState().setError(error) }
  },
  reject(id) { set(state => ({ edits: state.edits.map(edit => edit.id === id && edit.state === 'pending' ? { ...edit, state: 'rejected' } : edit) })) },
  insert(position) {
    const { target, source, result, phase } = get()
    if (!target || !result || phase !== 'complete') return
    try {
      if (target.conflict) throw new Error('目标正文已变化，请重新定位或复制结果。')
      const at = position === 'end' ? source.length : position === 'after' ? target.to : target.from
      const text = position === 'end' ? '\n\n' + result.content.trim() + '\n' : result.content
      const changes = ChangeSet.of({ from: at, insert: text }, source.length)
      writeChanges(target, source, source.slice(0, at) + text + source.slice(at), changes)
      set({ phase: 'idle', error: '' })
    } catch (error) { set({ error: String(error) }); useAppStore.getState().setError(error) }
  },
}))

// View navigation does not end a task. A different project clears it; a different chapter cancels it.
useAppStore.subscribe((state, previous) => {
  const task = useAiTask.getState(), target = task.target
  if (!target) return
  if (state.projectSession !== target.session || state.projectPath !== target.project) { task.clear(); return }
  if (state.document?.node.id !== target.node) { task.stop(); return }
  if (state.document.content !== task.source) task.observe(previous.document?.content ?? '', state.document.content)
})
