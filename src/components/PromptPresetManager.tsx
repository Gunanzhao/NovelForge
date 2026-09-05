import { useEffect, useMemo, useState } from 'react'
import { Copy, Eye, Play, Plus, Save, Trash2 } from 'lucide-react'
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

export function PromptPresetManager({ busy, onRun, defaultSystemPrompt = '你是 NovelForge 的中文小说创作助手。只处理模板中明确引用的上下文。' }: {
  defaultSystemPrompt?: string
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ preset: PromptPreset; resolution: PromptResolution; run: boolean } | null>(null)
  const presets = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'prompt-preset').map(parsePromptPreset).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')), [data?.entities])
  const selected = presets.find((preset) => preset.id === selectedId)

  useEffect(() => {
    if (!selected) {
      setDraft(BLANK)
      return
    }
    setDraft({
      name: selected.name,
      description: selected.description,
      prompt: selected.prompt,
      systemPrompt: selected.systemPrompt ?? '',
      action: selected.action,
    })
  }, [selected])

  useEffect(() => {
    const open = () => globalThis.document.querySelector('.prompt-preset-manager')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  async function save(copy = false) {
    if (!draft.name.trim() || !draft.prompt.trim()) return
    const preset = draftPreset(copy ? '' : selected?.id)
    setSaving(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'prompt-preset',
        id: copy ? null : selected?.id ?? null,
        title: copy ? `${preset.name} 副本` : preset.name,
        content: promptPresetContent(preset),
        tags: ['AI 模板', preset.action],
      })
      if (copy) setSelectedId(null)
    } catch (error) {
      setError(error)
    } finally {
      setSaving(false)
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

  return <Panel className="prompt-preset-manager">
    <div className="panel-title"><h3>我的模板</h3><Button variant="ghost" onClick={() => setSelectedId(null)}><Plus size={13} />新建</Button></div>
    <div className="prompt-preset-layout"><div className="prompt-preset-list">{presets.length ? presets.map((preset) => <button key={preset.id} className={preset.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(preset.id)}><strong>{preset.name}</strong><small>{preset.action} · {preset.description || '无说明'}</small></button>) : <span className="field-hint">还没有项目模板。</span>}</div><div className="prompt-preset-editor"><div className="field-grid"><Field label="名称"><TextInput value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="人物 OOC 检查" /></Field><Field label="类型"><select className="select-input" value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value as PromptPresetAction }))}><option value="generate">generate</option><option value="analyze">analyze</option><option value="rewrite">rewrite</option></select></Field></div><Field label="说明"><TextInput value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></Field><Field label="Prompt" hint="支持 selection、currentParagraph、currentChapter、recentChapters:1/3/5/10，以及 character/location/world/storyArc:名称"><textarea className="text-area prompt-template-text" value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} placeholder="请检查 {{character:林月}} 在 {{currentChapter}} 中的行为。" /></Field><Field label="System Prompt"><textarea className="text-area compact" value={draft.systemPrompt} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))} placeholder="可选" /></Field><div className="prompt-preset-actions"><Button disabled={saving || !draft.name.trim() || !draft.prompt.trim()} onClick={() => void save(false)}><Save size={13} />保存</Button>{selected ? <Button variant="outline" disabled={saving} onClick={() => void save(true)}><Copy size={13} />复制</Button> : null}<Button variant="outline" disabled={!draft.prompt.trim()} onClick={() => void previewDraft(false)}><Eye size={13} />预览</Button><Button disabled={busy || !draft.prompt.trim()} onClick={() => void previewDraft(true)}><Play size={13} />运行</Button>{selected ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={13} />删除</Button> : null}</div></div></div>
    {preview ? <Modal open title={`Prompt 预览 · ${preview.preset.name}`} onClose={() => setPreview(null)} footer={<><Button variant="outline" onClick={() => setPreview(null)}>取消</Button>{preview.run ? <Button disabled={busy} onClick={() => { const current = preview; setPreview(null); void onRun(current.preset, current.resolution) }}><Play size={13} />确认运行</Button> : null}</>}><div className="prompt-preview-meta"><span>字符数：{budget.characters.toLocaleString()}</span><span>估算 Token：{budget.estimatedTokens.toLocaleString()}</span><span>安全阈值：{budget.safeLimit.toLocaleString()} 字符{budget.overLimit ? ' · 超过安全阈值，请减少内容' : ''}</span></div><div className="prompt-preview-contexts"><strong>显式上下文项</strong>{preview.resolution.contexts.length ? preview.resolution.contexts.map((context) => <span key={context.variable}>{context.label} · {context.characters.toLocaleString()} 字符</span>) : <span>模板没有引用项目上下文。</span>}</div><h4>System Prompt</h4><pre className="prompt-preview-text">{systemPrompt}</pre><h4>User Prompt</h4><pre className="prompt-preview-text">{preview.resolution.prompt}</pre></Modal> : null}
  </Panel>
}
