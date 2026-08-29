import { useEffect, useMemo, useState } from 'react'
import { Clipboard, Eye, KeyRound, Send, Sparkles } from 'lucide-react'
import { isDesktop, projectApi } from '../lib/api'
import type { AiCompletionResult } from '../lib/types'
import {
  AI_ACTIONS, buildAiPrompt, contextItems, localAssist, readAiPreferences, writeAiPreferences,
} from '../lib/ai-data'
import type { AiAction, AiContextItem } from '../lib/ai-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'

export function AiAssistantView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const document = useAppStore((state) => state.document)
  const updateContent = useAppStore((state) => state.updateContent)
  const setError = useAppStore((state) => state.setError)
  const preferences = useMemo(() => readAiPreferences(), [])
  const [providerName, setProviderName] = useState(preferences.providerName ?? '')
  const [endpoint, setEndpoint] = useState(preferences.endpoint)
  const [model, setModel] = useState(preferences.model)
  const [temperature, setTemperature] = useState(String(preferences.temperature ?? 0.7))
  const [maxTokens, setMaxTokens] = useState(String(preferences.maxTokens ?? 4000))
  const [apiKey, setApiKey] = useState('')
  const [action, setAction] = useState<AiAction>('continue')
  const [instruction, setInstruction] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [contextContent, setContextContent] = useState<Record<string, string>>({})
  const [previewOpen, setPreviewOpen] = useState(false)
  const [result, setResult] = useState<AiCompletionResult | null>(null)
  const [busy, setBusy] = useState(false)

  const items = useMemo(() => data ? contextItems(data.nodes, data.entities, document?.node.id) : [], [data, document?.node.id])
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds])

  useEffect(() => {
    setSelectedIds((current) => {
      const valid = new Set(items.map((item) => item.id))
      const next = new Set([...current].filter((id) => valid.has(id)))
      if (!next.size && document) next.add(document.node.id)
      return next
    })
  }, [document, items])

  useEffect(() => {
    writeAiPreferences({
      endpoint, model, providerName,
      temperature: Number.parseFloat(temperature) || 0.7,
      maxTokens: Number.parseInt(maxTokens, 10) || 4000,
    })
  }, [endpoint, maxTokens, model, providerName, temperature])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function toggleContext(item: AiContextItem) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
      return next
    })
  }

  async function loadItemContent(item: AiContextItem) {
    const cached = contextContent[item.id]
    if (cached !== undefined) return cached
    let content = ''
    if (item.kind === 'node') {
      if (document?.node.id === item.id) content = document.content
      else content = (await projectApi.getDocument({ projectPath: currentProjectPath, nodeId: item.id })).content
    } else {
      const entity = data?.entities.find((candidate) => candidate.id === item.id)
      if (entity) content = JSON.stringify({ tags: entity.tags, ...entity.content }, null, 2)
    }
    setContextContent((current) => ({ ...current, [item.id]: content }))
    return content
  }

  async function loadSelectedContext() {
    const context: Array<{ title: string; kind: string; content: string }> = []
    for (const item of selectedItems) context.push({ title: item.title, kind: item.detail, content: await loadItemContent(item) })
    return context
  }

  async function runAssistant() {
    if (!selectedItems.length) { setError('请至少选择一项上下文，再运行 AI 辅助。'); return }
    setBusy(true)
    try {
      const context = await loadSelectedContext()
      const prompt = buildAiPrompt(action, context, instruction)
      if (!endpoint.trim() || endpoint.trim().toLocaleLowerCase() === 'local' || !isDesktop) {
        const local = localAssist(action, context, instruction)
        setResult({ content: local.localContent, model: local.model })
      } else {
        setResult(await projectApi.aiComplete({ endpoint, apiKey, model, systemPrompt: '你是 NovelForge 的中文小说创作助手。只处理用户明确选中的上下文，不擅自引入未提供的事实。', prompt, temperature: Math.max(0, Math.min(2, Number.parseFloat(temperature) || 0.7)), maxTokens: Math.max(1, Math.min(32_000, Number.parseInt(maxTokens, 10) || 4000)) }))
      }
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function showPreview() {
    if (!selectedItems.length) { setError('请至少选择一项上下文。'); return }
    setBusy(true)
    try { await loadSelectedContext(); setPreviewOpen(true) } catch (error) { setError(error) } finally { setBusy(false) }
  }

  function applyResult(mode: 'replace' | 'append') {
    if (!result || !document) return
    if (mode === 'replace' && !window.confirm('这会用 AI 结果覆盖当前正文，当前内容可从版本历史恢复。是否继续？')) return
    updateContent(mode === 'replace' ? result.content : `${document.content.trimEnd()}\n\n${result.content.trim()}\n`)
  }

  const previewText = selectedItems.map((item) => `【${item.detail}｜${item.title}】\n${contextContent[item.id] ?? '正在读取…'}`).join('\n\n')
  return <div className="workspace-view ai-view"><div className="view-header"><div><p className="eyebrow">OPTIONAL AI ASSISTANT</p><h1>AI 辅助</h1><p>显式选择上下文后再发送请求；不填写 Provider 地址时使用本地离线草稿模式。</p></div><div className="ai-mode-badge"><Sparkles size={14} />{endpoint.trim() && isDesktop ? '兼容 Provider' : '本地离线模式'}</div></div><div className="ai-config-row"><Panel className="ai-provider-card"><div className="panel-title"><h3>Provider 设置</h3><span>{apiKey ? '本次会话已填写 Key' : '未填写 API Key'}</span></div><Field label="名称"><TextInput value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="例如：本地 LM Studio" /></Field><div className="field-grid"><Field label="Base URL" hint="例如 http://127.0.0.1:1234/v1"><TextInput value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="留空使用本地离线模式" /></Field><Field label="模型"><TextInput value={model} onChange={(event) => setModel(event.target.value)} placeholder="local-writer" /></Field></div><div className="field-grid"><Field label="Temperature"><TextInput type="number" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} /></Field><Field label="Max Tokens"><TextInput type="number" min="1" max="32000" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} /></Field></div><Field label="API Key" hint="仅保留在当前窗口内，既不保存也不写入日志"><div className="input-with-action"><KeyRound size={14} color="var(--faint)" style={{ marginTop: 8 }} /><TextInput type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="可选；本地 Provider 通常不需要" autoComplete="off" /></div></Field></Panel><Panel className="ai-action-card"><div className="panel-title"><h3>辅助任务</h3><span>{selectedItems.length} 项上下文</span></div><Field label="任务"><select className="select-input" value={action} onChange={(event) => setAction(event.target.value as AiAction)}>{AI_ACTIONS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}</select></Field><Field label="写作要求"><textarea className="text-area compact" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：保持第一人称，增加悬念，不改变已有设定…" /></Field><div className="ai-action-buttons"><Button variant="outline" disabled={busy} onClick={() => void showPreview()}><Eye size={14} />预览上下文</Button><Button disabled={busy} onClick={() => void runAssistant()}><Send size={14} />{busy ? '处理中…' : '运行辅助'}</Button></div></Panel></div><div className="ai-workspace-grid"><Panel className="ai-context-panel"><div className="panel-title"><h3>明确选择上下文</h3><span>未勾选内容不会发送</span></div><div className="ai-context-list">{items.length ? items.map((item) => <label className={'ai-context-item' + (selectedIds.has(item.id) ? ' active' : '')} key={item.id}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleContext(item)} /><span><strong>{item.title}</strong><small>{item.detail}</small></span></label>) : <div className="empty-state">没有可用的正文或资料。</div>}</div></Panel><Panel className="ai-result-panel"><div className="panel-title"><h3>AI 结果</h3><span>{result ? result.model : '尚未运行'}</span></div>{result ? <><textarea className="text-area ai-result-text" value={result.content} onChange={(event) => setResult((current) => current ? { ...current, content: event.target.value } : current)} /><div className="ai-result-actions"><Button variant="outline" onClick={() => void navigator.clipboard?.writeText(result.content)}><Clipboard size={13} />复制</Button>{document ? <><Button variant="outline" onClick={() => applyResult('append')}>追加到正文</Button><Button onClick={() => applyResult('replace')}>替换当前正文</Button></> : null}</div></> : <div className="ai-result-empty"><Sparkles size={28} /><strong>等待一次辅助任务</strong><span>结果会出现在这里，你可以先编辑结果，再追加或替换正文。</span></div>}</Panel></div>{previewOpen ? <Panel className="ai-preview-panel"><div className="panel-title"><h3>上下文预览</h3><Button variant="ghost" onClick={() => setPreviewOpen(false)}>关闭</Button></div><pre>{previewText}</pre></Panel> : null}</div>
}
