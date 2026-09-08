import { useUnsavedDraft } from '../hooks/useUnsavedDraft'
import { markDraftSaved, setDraftSaving, runGuarded } from '../lib/draft-guard'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Braces, Copy, Eye, Play, Plus, Save, Trash2 } from 'lucide-react'
import {
  parsePromptPreset, promptPresetContent, resolvePromptTemplate,
} from '../lib/prompt-preset'
import type { PromptPreset, PromptPresetAction, PromptResolution } from '../lib/prompt-preset'
import { estimateContextBudget } from '../lib/ai-data'
import { projectApi } from '../lib/api'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Modal, Panel, TextInput } from './ui'

interface Draft {
  name: string
  description: string
  prompt: string
  systemPrompt: string
  action: PromptPresetAction
}

const BLANK: Draft = { name: '', description: '', prompt: '', systemPrompt: '', action: 'analyze' }
const ACTION_LABELS: Record<PromptPresetAction, string> = { generate: '创作生成', analyze: '分析检查', rewrite: '改写润色' }
const QUICK_VARIABLES = [
  ['当前章节', 'currentChapter'], ['当前选区', 'selection'],
  ['当前段落', 'currentParagraph'], ['最近 3 章', 'recentChapters:3'],
] as const

export function PromptPresetManager({ busy, onRun, presentation = 'panel', defaultSystemPrompt = '你是 NovelForge 的中文小说创作助手。只处理模板中明确引用的上下文。' }: {
  defaultSystemPrompt?: string
  presentation?: 'panel' | 'launcher'
  busy: boolean
  onRun: (preset: PromptPreset, resolution: PromptResolution) => Promise<void>
}) {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const document = useAppStore((state) => state.document)
  const editorSelection = useAppStore((state) => state.editorSelection)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const setError = useAppStore((state) => state.setError)
  const newEntityId = useRef<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [baseline, setBaseline] = useState(() => JSON.stringify(BLANK))
  const draftId = 'prompt-preset:' + projectPath
  useUnsavedDraft(draftId, 'AI 模板', JSON.stringify(draft) !== baseline, () => save(), () => setDraft(JSON.parse(baseline) as Draft))
  const [saving, setSaving] = useState(false)
  const [systemOpen, setSystemOpen] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState<{ preset: PromptPreset; resolution: PromptResolution; run: boolean } | null>(null)
  const presets = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'prompt-preset').map(parsePromptPreset).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')), [data?.entities])
  const selectedJson = JSON.stringify(presets.find((preset) => preset.id === selectedId) ?? null)
  const selected = useMemo(() => JSON.parse(selectedJson) as PromptPreset | null, [selectedJson])

  useEffect(() => {
    if (!selected) {
      setBaseline(JSON.stringify(BLANK))
      setDraft(BLANK)
      setSystemOpen(false)
      return
    }
    const next: Draft = {
      name: selected.name,
      description: selected.description,
      prompt: selected.prompt,
      systemPrompt: selected.systemPrompt ?? '',
      action: selected.action,
    }
    setDraft(next)
    setBaseline(JSON.stringify(next))
    setSystemOpen(Boolean(selected.systemPrompt))
  }, [selected])

  useEffect(() => {
    const open = () => { setVisible(true); window.requestAnimationFrame(() => globalThis.document.querySelector('.prompt-preset-manager')?.scrollIntoView({ block: 'nearest' })) }
    const run = () => {
      open()
      const preset = presets[0]
      if (preset) void preparePreview(preset, true)
    }
    window.addEventListener('novelforge:open-prompt-presets', open)
    window.addEventListener('novelforge:run-prompt-preset', run)
    return () => {
      window.removeEventListener('novelforge:open-prompt-presets', open)
      window.removeEventListener('novelforge:run-prompt-preset', run)
    }
  })

  if (!data || !projectPath) return null
  const currentData = data
  const currentProjectPath = projectPath

  function draftPreset(id = selected?.id ?? ''): PromptPreset {
    const variables = [...draft.prompt.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu)].map((match) => ({ variable: match[1].trim() }))
    return {
      id,
      name: draft.name.trim(),
      description: draft.description,
      prompt: draft.prompt,
      systemPrompt: draft.systemPrompt || undefined,
      action: draft.action,
      defaultContexts: variables,
      createdAt: selected?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  function insertVariable(variable: string) {
    const input = promptRef.current
    const start = input?.selectionStart ?? draft.prompt.length
    const end = input?.selectionEnd ?? start
    const text = '{{' + variable + '}}'
    setDraft(current => ({ ...current, prompt: current.prompt.slice(0, start) + text + current.prompt.slice(end) }))
    window.requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + text.length, start + text.length) })
  }

  async function save(copy = false) {
    if (!draft.name.trim() || !draft.prompt.trim()) return false
    const id = copy ? crypto.randomUUID() : selected?.id ?? (newEntityId.current ??= crypto.randomUUID())
    const preset = draftPreset(id)
    if (saving) return false
    setDraftSaving(draftId, true)
    setSaving(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'prompt-preset',
        id,
        title: copy ? `${preset.name} 副本` : preset.name,
        content: promptPresetContent(preset),
        tags: ['AI 模板', preset.action],
      })
      setSelectedId(id)
      setBaseline(JSON.stringify(draft))
      markDraftSaved(draftId)
      return true
    } catch (error) {
      setError(error); return false
    } finally {
      setDraftSaving(draftId, false); setSaving(false)
    }
  }

  async function preparePreview(preset: PromptPreset, run: boolean) {
    try {
      const resolution = await resolvePromptTemplate(preset.prompt, {
        data: currentData,
        currentNodeId: document?.node.id,
        currentContent: document?.content,
        selection: editorSelection,
        loadDocument: async (nodeId) => (await projectApi.getDocument({ projectPath: currentProjectPath, nodeId })).content,
      })
      if (resolution.errors.length) {
        setError(resolution.errors.join('\n'))
        return
      }
      setPreview({ preset, resolution, run })
    } catch (error) {
      setError(error)
    }
  }

  async function previewDraft(run: boolean) {
    if (!draft.name.trim() || !draft.prompt.trim()) return
    await preparePreview(draftPreset(), run)
  }

  async function remove() {
    if (!selected || !window.confirm(`将模板“${selected.name}”移入回收站？`)) return
    await deleteEntity(selected.id)
    setSelectedId(null)
  }

  const systemPrompt = preview?.preset.systemPrompt ?? defaultSystemPrompt
  const budget = estimateContextBudget([{ title: 'system', kind: 'system', content: systemPrompt }, { title: 'user', kind: 'user', content: preview?.resolution.prompt ?? '' }])

  const content = <Panel className="prompt-preset-manager">
    <div className="preset-manager-head"><div className="preset-heading"><span className="preset-heading-icon"><BookOpen size={18} /></span><div><h3>我的模板 <span>{presets.length}</span></h3><p>把常用写作要求保存下来，下次直接使用。</p></div></div><Button variant="outline" onClick={() => runGuarded(() => { newEntityId.current = null; setSelectedId(null); setDraft(BLANK); setBaseline(JSON.stringify(BLANK)); setSystemOpen(false) })}><Plus size={13} />新建</Button></div>
    <div className={'prompt-preset-layout' + (presets.length ? '' : ' is-empty')}>
      <div className="prompt-preset-list">{presets.length ? presets.map(preset => <button key={preset.id} className={preset.id === selectedId ? 'active' : ''} onClick={() => runGuarded(() => setSelectedId(preset.id))}><strong>{preset.name}</strong><small>{ACTION_LABELS[preset.action]} · {preset.description || '无说明'}</small></button>) : <div className="preset-empty"><BookOpen size={20} /><div><strong>创建你的第一个模板</strong><p>例如人物一致性检查、章节润色或剧情分析。填写下方内容即可保存。</p></div></div>}</div>
      <div className="prompt-preset-editor" inert={saving}>
        <div className="preset-editor-heading"><span>{selected ? '编辑模板' : '新模板'}</span><small>只有模板中引用的内容会进入请求</small></div>
        <div className="preset-meta-grid"><Field label="名称"><TextInput value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="人物 OOC 检查" /></Field><Field label="类型"><select className="select-input" value={draft.action} onChange={event => setDraft(current => ({ ...current, action: event.target.value as PromptPresetAction }))}>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
        <Field label="说明（可选）"><TextInput value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="简要说明这个模板适合什么场景" /></Field>
        <Field label="写作指令（Prompt）"><textarea ref={promptRef} className="text-area prompt-template-text" value={draft.prompt} onChange={event => setDraft(current => ({ ...current, prompt: event.target.value }))} placeholder="请检查 {{character:林月}} 在 {{currentChapter}} 中的行为。" /></Field>
        <div className="preset-variable-bar"><span><Braces size={13} />插入上下文</span>{QUICK_VARIABLES.map(([label, variable]) => <button type="button" key={variable} title={'插入 {{' + variable + '}}'} onMouseDown={event => event.preventDefault()} onClick={() => insertVariable(variable)}>{label}</button>)}<span className="preset-char-count">{draft.prompt.length} 字符</span></div>
        <details className="preset-variable-help"><summary>更多变量与用法</summary><p>用双花括号引用资料，例如 <code>{'{{character:林月}}'}</code>。支持人物 character、地点 location、世界观 world、剧情线 storyArc，冒号后填写名称；recentChapters 支持 1 / 3 / 5 / 10 章。</p></details>
        <details className="preset-system-settings" open={systemOpen} onToggle={event => setSystemOpen(event.currentTarget.open)}><summary>高级设置 <span>System Prompt · 可选</span></summary><Field label="System Prompt"><textarea className="text-area compact" value={draft.systemPrompt} onChange={event => setDraft(current => ({ ...current, systemPrompt: event.target.value }))} placeholder="留空使用默认小说创作助手；可在这里补充角色与全局规则" /></Field></details>
        <div className="prompt-preset-actions"><Button disabled={saving || !draft.name.trim() || !draft.prompt.trim()} onClick={() => void save(false)}><Save size={13} />{saving ? '保存中…' : '保存'}</Button>{selected ? <><Button variant="ghost" disabled={saving} onClick={() => void save(true)}><Copy size={13} />复制</Button><Button variant="ghost" onClick={() => void remove()}><Trash2 size={13} />删除</Button></> : null}<span className="preset-action-spacer" /><Button variant="outline" disabled={!draft.name.trim() || !draft.prompt.trim()} onClick={() => void previewDraft(false)}><Eye size={13} />预览</Button><Button disabled={busy || !draft.name.trim() || !draft.prompt.trim()} onClick={() => void previewDraft(true)}><Play size={13} />运行</Button></div>
      </div>
    </div>
    {preview ? <Modal open title={`Prompt 预览 · ${preview.preset.name}`} onClose={() => setPreview(null)} footer={<><Button variant="outline" onClick={() => setPreview(null)}>取消</Button>{preview.run ? <Button disabled={busy} onClick={() => { const current = preview; setPreview(null); setVisible(false); void onRun(current.preset, current.resolution) }}><Play size={13} />确认运行</Button> : null}</>}><div className="prompt-preview-meta"><span>字符数：{budget.characters.toLocaleString()}</span><span>估算 Token：{budget.estimatedTokens.toLocaleString()}</span><span>安全阈值：{budget.safeLimit.toLocaleString()} 字符{budget.overLimit ? ' · 超过安全阈值，请减少内容' : ''}</span></div><div className="prompt-preview-contexts"><strong>显式上下文项</strong>{preview.resolution.contexts.length ? preview.resolution.contexts.map((context) => <span key={context.variable}>{context.label} · {context.characters.toLocaleString()} 字符</span>) : <span>模板没有引用项目上下文。</span>}</div><h4>System Prompt</h4><pre className="prompt-preview-text">{systemPrompt}</pre><h4>User Prompt</h4><pre className="prompt-preview-text">{preview.resolution.prompt}</pre></Modal> : null}
  </Panel>
  if (presentation === 'panel') return content
  return <><Button variant="outline" className="ai-template-launcher" onClick={() => setVisible(true)}><BookOpen size={14} />使用模板</Button><div className="ai-template-dialog"><Modal open={visible} title="写作模板" onClose={() => setVisible(false)}>{content}</Modal></div></>
}
