import { attachmentContextText } from '../lib/attachment-data'
import { isNodeLocked } from '../lib/node-lock'
import { parseTemperature } from '../lib/ai-data'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clipboard, Eye, KeyRound, Send, Sparkles, TriangleAlert } from 'lucide-react'
import { isDesktop, projectApi } from '../lib/api'
import type { AiCompletionResult } from '../lib/types'
import { aiHttpConfirmationKey, confirmInsecureAiEndpoint } from '../lib/ai-security'
import {
  AI_ACTIONS, applyAiSelectionResult, buildAiPrompt, contextItems, estimateContextBudget,
  isSelectionAction, localAssist, recentChapterIds, readAiPreferences, writeAiPreferences,
} from '../lib/ai-data'
import type { AiAction, AiContextItem } from '../lib/ai-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Modal, Panel, TextInput } from './ui'
import { PromptPresetManager } from './PromptPresetManager'
import { CodexSettings } from './CodexSettings'
import { codexApi } from '../lib/codex'
import { useCodexSession } from '../stores/codex-session'
import type { AiPreferences } from '../lib/ai-data'
import type { PromptPreset, PromptPresetAction, PromptResolution } from '../lib/prompt-preset'

const SYSTEM_PROMPT = '你是 NovelForge 的中文小说创作助手。只处理用户明确选中的上下文，不擅自引入未提供的事实。'
const PRESET_SYSTEM_PROMPT = '你是 NovelForge 的中文小说创作助手。只处理模板中明确引用的上下文。'

export function AiAssistantView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const document = useAppStore((state) => state.document)
  const editorSelection = useAppStore((state) => state.editorSelection)
  const requestedAiAction = useAppStore((state) => state.requestedAiAction)
  const consumeAiAction = useAppStore((state) => state.consumeAiAction)
  const updateContent = useAppStore((state) => state.updateContent)
  const setEditorSelection = useAppStore((state) => state.setEditorSelection)
  const setError = useAppStore((state) => state.setError)
  const preferences = useMemo(() => readAiPreferences(), [])
  const [mode, setMode] = useState<NonNullable<AiPreferences['mode']>>(preferences.mode ?? 'offline')
  const [codexPath, setCodexPath] = useState(preferences.codexPath ?? '')
  const [codexModel, setCodexModel] = useState(preferences.codexModel ?? '')
  const [codexEffort, setCodexEffort] = useState(preferences.codexEffort ?? 'low')
  const [codexReady, setCodexReady] = useState(false)
  const [resultComplete, setResultComplete] = useState(false)
  const [resultStatus, setResultStatus] = useState('')
  const activeRequest = useRef<string | null>(null)
  const stoppedRequest = useRef<string | null>(null)
  const resultTarget = useRef<{ project: string | null; node: string | null; content: string | null } | null>(null)
  const mounted = useRef(true)
  const [providerName, setProviderName] = useState(preferences.providerName ?? '')
  const [endpoint, setEndpoint] = useState(preferences.endpoint)
  const [model, setModel] = useState(preferences.model)
  const [temperature, setTemperature] = useState(String(preferences.temperature ?? 0.7))
  const [maxTokens, setMaxTokens] = useState(String(preferences.maxTokens ?? 4000))
  const [apiKey, setApiKey] = useState('')
  const [action, setAction] = useState<AiAction>('continue')
  const [instruction, setInstruction] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loadedContext, setLoadedContext] = useState<Array<{ title: string; kind: string; content: string }>>([])
  const [recentCount, setRecentCount] = useState(3)
  const [requestSelection, setRequestSelection] = useState<typeof editorSelection>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [result, setResult] = useState<AiCompletionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [resultApplication, setResultApplication] = useState<'builtin' | PromptPresetAction>('builtin')
  const confirmedHttpProviders = useRef(new Set<string>())

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const id = activeRequest.current
      activeRequest.current = null
      if (id) void codexApi.cancel(id).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!requestedAiAction) return
    setAction(requestedAiAction)
    consumeAiAction()
  }, [consumeAiAction, requestedAiAction])

  useEffect(() => {
    if (!result) return
    const cancelResult = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || globalThis.document.querySelector('[role="dialog"]')) return
      if (activeRequest.current) {
        stoppedRequest.current = activeRequest.current
        setResultComplete(false)
        setResultStatus('正在停止 · 结果未完成')
        void codexApi.cancel(activeRequest.current).catch(setError)
        return
      }
      setResult(null)
      setRequestSelection(null)
    }
    window.addEventListener('keydown', cancelResult)
    return () => window.removeEventListener('keydown', cancelResult)
  }, [result, setError])

  const items = useMemo(() => data ? contextItems(data.nodes, data.entities, document?.node.id, document?.content, editorSelection) : [], [data, document?.content, document?.node.id, editorSelection])
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds])
  const recentIds = useMemo(() => data ? recentChapterIds(data.nodes, document?.node.id, recentCount) : [], [data, document?.node.id, recentCount])
  const recentItems = useMemo(() => items.filter((item) => item.kind === 'node' && recentIds.includes(item.id)), [items, recentIds])

  useEffect(() => {
    setLoadedContext([])
    setPreviewOpen(false)
  }, [projectPath, selectedItems])

  useEffect(() => {
    setSelectedIds((current) => {
      const valid = new Set(items.map((item) => item.id))
      const next = new Set([...current].filter((id) => valid.has(id)))
      if (!next.size && document) next.add(document.node.id)
      const selectionItem = items.find((item) => item.kind === 'selection')
      if (selectionItem && editorSelection?.text.trim()) next.add(selectionItem.id)
      return next
    })
  }, [document, editorSelection, items])

  useEffect(() => {
    writeAiPreferences({
      mode, codexPath, codexModel, codexEffort,
      endpoint, model, providerName,
      temperature: parseTemperature(temperature),
      maxTokens: Number.parseInt(maxTokens, 10) || 4000,
    })
  }, [endpoint, maxTokens, model, providerName, temperature, mode, codexPath, codexModel, codexEffort])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  async function complete(systemPrompt: string, prompt: string, localResult: { content: string; model: string }) {
    setResultComplete(false)
    setResultStatus('')
    setResult(null)
    resultTarget.current = { project: projectPath, node: document?.node.id ?? null, content: document?.content ?? null }
    if (mode === 'codex') {
      if (!isDesktop || !codexReady) throw new Error('请在桌面版检查 Codex 连接并完成 ChatGPT 登录。')
      const id = crypto.randomUUID()
      activeRequest.current = id
      stoppedRequest.current = null
      setResultStatus('生成中')
      setResult({ content: '', model: codexModel })
      try {
        const answer = await codexApi.generate({ cliPath: codexPath, requestId: id, model: codexModel, effort: codexEffort, systemPrompt, prompt }, (delta) => {
          if (mounted.current && activeRequest.current === id && stoppedRequest.current !== id) {
            setResult((current) => ({ content: (current?.content ?? '') + delta, model: codexModel }))
          }
        }, () => !mounted.current || stoppedRequest.current === id)
        if (mounted.current && activeRequest.current === id && stoppedRequest.current !== id) {
          setResult(answer); setResultComplete(true); setResultStatus('已完成')
        }
      } catch (e) {
        if (mounted.current && activeRequest.current === id && stoppedRequest.current !== id) useCodexSession.getState().invalidate('生成连接未通过，请重新检查连接。')
        if (mounted.current && activeRequest.current === id) setResultStatus(stoppedRequest.current === id ? '已停止 · 结果未完成' : '生成失败 · 结果未完成')
        throw e
      } finally {
        if (mounted.current && stoppedRequest.current === id) setResultStatus('已停止 · 结果未完成')
        if (activeRequest.current === id) activeRequest.current = null
      }
      return
    }
    if (mode === 'offline' || !endpoint.trim() || endpoint.trim().toLowerCase() === 'local' || !isDesktop) {
      setResult(localResult)
    } else {
      if (!confirmInsecureAiEndpoint(endpoint, confirmedHttpProviders.current, (message) => window.confirm(message))) return
      const answer = await projectApi.aiComplete({ endpoint, apiKey, model, systemPrompt, prompt, temperature: parseTemperature(temperature), maxTokens: Math.max(1, Math.min(32_000, Number.parseInt(maxTokens, 10) || 4000)) })
      if (!mounted.current) return
      setResult(answer)
    }
    setResultComplete(true)
    setResultStatus('已完成')
  }

  async function stopGeneration() {
    const id = activeRequest.current
    if (!id) return
    stoppedRequest.current = id
    setResultComplete(false)
    setResultStatus('正在停止 · 结果未完成')
    try { await codexApi.cancel(id) } catch (e) { setError(e) }
  }

  function canApplyResult() {
    const target = resultTarget.current
    const current = useAppStore.getState()
    if (isNodeLocked(current.data?.nodes ?? [], current.document?.node.id)) {
      setError('正文已锁定，请先解锁；AI 结果仍可复制。')
      return false
    }
    if (!resultComplete || busy || !target || current.projectPath !== target.project || current.document?.node.id !== target.node || current.document?.content !== target.content) {
      setError('结果未完成，或目标章节/正文已变化。请复制结果或重新生成。')
      return false
    }
    return true
  }

  function toggleContext(item: AiContextItem) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
      return next
    })
  }

  function selectRecentChapters() {
    setSelectedIds((current) => new Set([...current, ...recentItems.map((item) => item.id)]))
  }

  async function loadItemContent(item: AiContextItem) {
    let content = ''
    if (item.kind === 'node') {
      if (document?.node.id === item.id) content = document.content
      else content = (await projectApi.getDocument({ projectPath: currentProjectPath, nodeId: item.id })).content
    } else if (item.kind === 'selection' || item.kind === 'paragraph') {
      const currentDocument = document
      if (currentDocument && currentDocument.node.id === item.nodeId && item.range) {
        const range = item.range
        content = currentDocument.content.slice(range.from, range.to)
      }
    } else {
      const entity = data?.entities.find((candidate) => candidate.id === item.id)
      if (entity) content = entity.kind === 'attachment' ? attachmentContextText(entity) : JSON.stringify({ tags: entity.tags, ...entity.content }, null, 2)
    }
    return content
  }

  async function loadSelectedContext() {
    const context: Array<{ title: string; kind: string; content: string }> = []
    for (const item of selectedItems) context.push({ title: item.title, kind: item.detail, content: await loadItemContent(item) })
    setLoadedContext(context)
    return context
  }

  async function runAssistant() {
    if (busy) return
    if (!selectedItems.length) { setError('请至少选择一项上下文，再运行 AI 辅助。'); return }
    if (isSelectionAction(action) && (!editorSelection || editorSelection.nodeId !== document?.node.id || !editorSelection.text.trim())) {
      setError('当前任务需要先在编辑器中选中一段正文。')
      return
    }
    setBusy(true)
    try {
      const context = await loadSelectedContext()
      const prompt = buildAiPrompt(action, context, instruction)
      const budget = estimateContextBudget([{ title: 'system', kind: 'system', content: SYSTEM_PROMPT }, { title: 'user', kind: 'user', content: prompt }])
      if (budget.overLimit) {
        setError('System 与 User Prompt 总和超过安全阈值，请减少写作要求、章节或资料后重试。')
        return
      }
      setRequestSelection(isSelectionAction(action) ? editorSelection : null)
      setResultApplication('builtin')
      const local = localAssist(action, context, instruction)
      await complete(SYSTEM_PROMPT, prompt, { content: local.localContent, model: local.model })
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  async function runPreset(preset: PromptPreset, resolution: PromptResolution) {
    if (busy) return
    const systemPrompt = preset.systemPrompt ?? PRESET_SYSTEM_PROMPT
    const budget = estimateContextBudget([{ title: 'system', kind: 'system', content: systemPrompt }, { title: 'user', kind: 'user', content: resolution.prompt }])
    if (budget.overLimit) {
      setError('System 与 User Prompt 总和超过安全阈值，请减少系统提示词、模板或引用的上下文。')
      return
    }
    if (preset.action === 'rewrite' && (!editorSelection || editorSelection.nodeId !== document?.node.id || !editorSelection.text.trim())) {
      setError('rewrite 模板需要先在编辑器中选择一段正文。')
      return
    }
    setBusy(true)
    try {
      setRequestSelection(preset.action === 'rewrite' ? editorSelection : null)
      setResultApplication(preset.action)
      await complete(systemPrompt, resolution.prompt, { content: `【本地模板草稿】\n\n${resolution.prompt}`, model: 'novelforge-local' })
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

  function applySelectionResult(mode: 'replace' | 'insert-after') {
    if (!canApplyResult()) return
    const selection = useAppStore.getState().editorSelection
    if (!selection || !requestSelection || selection.nodeId !== requestSelection.nodeId || selection.from !== requestSelection.from || selection.to !== requestSelection.to || selection.text !== requestSelection.text) {
      setError('原选区已变化，请复制结果或重新生成。')
      return
    }
    if (!result || !document || !requestSelection || requestSelection.nodeId !== document.node.id || requestSelection.to <= requestSelection.from) {
      setError('当前 AI 结果没有可用的原文选区，请重新选择正文后再运行。')
      return
    }
    const next = applyAiSelectionResult(document.content, requestSelection.from, requestSelection.to, result.content, mode)
    updateContent(next)
    const nextFrom = mode === 'replace' ? requestSelection.from : requestSelection.to
    setEditorSelection({ nodeId: document.node.id, from: nextFrom, to: nextFrom + result.content.length, text: result.content })
  }

  const selectionReady = Boolean(editorSelection && document && editorSelection.nodeId === document.node.id && editorSelection.to > editorSelection.from && editorSelection.text.trim())
  const selectionAction = resultApplication === 'rewrite' || (resultApplication === 'builtin' && isSelectionAction(action))

  function applyResult(mode: 'replace' | 'append') {
    if (!canApplyResult()) return
    if (!result || !document) return
    if (mode === 'replace' && !window.confirm('这会用 AI 结果覆盖当前正文，当前内容可从版本历史恢复。是否继续？')) return
    updateContent(mode === 'replace' ? result.content : `${document.content.trimEnd()}\n\n${result.content.trim()}\n`)
  }

  const previewText = buildAiPrompt(action, loadedContext, instruction)
  const contextBudget = estimateContextBudget([{ title: 'system', kind: 'system', content: SYSTEM_PROMPT }, { title: 'user', kind: 'user', content: previewText }])
  const insecureHttpProvider = aiHttpConfirmationKey(endpoint) !== null
  const quickActions: AiAction[] = ['continue', 'polish', 'summary']
  const connectionLocked = busy
  return <div className="workspace-view ai-view ai-workbench">
    <div className="view-header ai-workbench-header"><div><p className="eyebrow">WRITING ASSISTANT</p><h1>AI 辅助</h1></div><span className="ai-workbench-subtitle">选择资料与任务，预览后应用结果</span></div>
    <div className="ai-connection-bar" aria-label="AI 连接">
      <Field label="AI 模式"><select aria-label="AI 模式" className="select-input" value={mode} disabled={connectionLocked} onChange={(e) => { setMode(e.target.value as NonNullable<AiPreferences['mode']>); setCodexReady(false); setResult(null); setResultComplete(false); setConnectionOpen(false) }}><option value="offline">本地离线</option><option value="provider">兼容 Provider</option><option value="codex">Codex 订阅（实验性）</option></select></Field>
      {mode === 'codex' ? <CodexSettings compact path={codexPath} model={codexModel} effort={codexEffort} busy={busy} onPath={setCodexPath} onModel={setCodexModel} onEffort={setCodexEffort} onReady={setCodexReady} /> : mode === 'provider' ? <>
        <Field label="模型"><TextInput value={model} disabled={busy} onChange={(event) => setModel(event.target.value)} placeholder="模型名称" /></Field>
        <span className="ai-connection-state">{endpoint.trim() ? providerName || '已配置 Provider' : '待配置连接'}</span>
        <Button variant="outline" onClick={() => setConnectionOpen(true)}>连接设置</Button>
      </> : <><span className="ai-connection-state">本地草稿 · 无需连接</span><Button variant="outline" onClick={() => { setMode('provider'); setConnectionOpen(true) }}>配置 Provider</Button></>}
      {mode === 'provider' && insecureHttpProvider ? <div className="ai-provider-warning"><TriangleAlert size={14} /><span>该地址使用非加密 HTTP。发送时，小说内容和 API Key 可能被网络中的其他人读取或篡改。</span></div> : null}
    </div>
    <div className="ai-workbench-grid">
      <Panel className="ai-compose-panel" aria-label="写作任务与参考资料">
        <div className="ai-compose-scroll">
          <div className="panel-title"><h3>写作任务</h3><PromptPresetManager presentation="launcher" busy={busy || (mode === 'codex' && !codexReady)} onRun={runPreset} defaultSystemPrompt={PRESET_SYSTEM_PROMPT} /></div>
          <div className="ai-task-picker" aria-label="常用任务">
            {AI_ACTIONS.filter((item) => quickActions.includes(item.id)).map((item) => <Button key={item.id} variant="ghost" aria-pressed={action === item.id} disabled={busy} onClick={() => setAction(item.id)}>{item.label}</Button>)}
            <select aria-label="更多任务" className="select-input" value={quickActions.includes(action) ? '' : action} disabled={busy} onChange={(event) => setAction(event.target.value as AiAction)}><option value="" disabled>更多任务</option>{AI_ACTIONS.filter((item) => !quickActions.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </div>
          <p className="ai-task-description">{AI_ACTIONS.find((item) => item.id === action)?.description}</p>
          <Field label="写作要求"><textarea className="text-area ai-instruction-input" disabled={busy} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：保持第一人称，增加悬念，不改变已有设定…" /></Field>
          <div className="ai-context-section">
            <div className="panel-title"><h3>参考资料</h3><span>{selectedItems.length} 项上下文</span></div>
            <p className="ai-context-hint">只有勾选的资料会加入请求</p>
            <div className="ai-context-tools"><label>最近章节<select aria-label="最近章节" value={recentCount} disabled={busy} onChange={(event) => setRecentCount(Number(event.target.value))}><option value="1">1 章</option><option value="3">3 章</option><option value="5">5 章</option><option value="10">10 章</option></select></label><Button variant="outline" disabled={busy || !recentItems.length} onClick={selectRecentChapters}>选中最近 {recentCount} 章</Button></div>
            {selectionReady ? <div className="ai-selection-hint">已捕获当前选区：{editorSelection?.text.length.toLocaleString()} 字，可用于润色、改写、扩写或缩写。</div> : null}
            <div className="ai-context-list">{items.length ? items.map((item) => <label className={'ai-context-item' + (selectedIds.has(item.id) ? ' active' : '')} key={item.id}><input type="checkbox" disabled={busy} checked={selectedIds.has(item.id)} onChange={() => toggleContext(item)} /><span><strong>{item.title}</strong><small>{item.detail}</small></span></label>) : <div className="empty-state">没有可用的正文或资料。</div>}</div>
          </div>
        </div>
        <div className="ai-compose-footer">
          <span className={'ai-budget-summary' + (contextBudget.overLimit ? ' over' : '')}>{loadedContext.length ? `${contextBudget.characters.toLocaleString()} 字符 · 预计 ${contextBudget.estimatedTokens.toLocaleString()} Token${contextBudget.overLimit ? ' · 超过安全阈值' : ''}` : '预览可查看实际发送内容与长度'}</span>
          <div className="ai-action-buttons"><Button variant="outline" disabled={busy} onClick={() => void showPreview()}><Eye size={14} />预览上下文</Button><Button disabled={busy || (mode === 'codex' && !codexReady)} onClick={() => void runAssistant()}><Send size={14} />{busy ? '处理中…' : '运行辅助'}</Button>{busy && mode === 'codex' ? <Button variant="outline" onClick={() => void stopGeneration()}>停止生成</Button> : null}</div>
          {mode === 'codex' && !codexReady && !busy ? <span className="ai-context-hint">请先检查连接并完成登录</span> : null}
        </div>
      </Panel>
      <Panel className="ai-output-panel" aria-label="AI 结果工作区">
        <div className="panel-title ai-output-heading"><h3>AI 结果</h3><span role="status">{result ? `${result.model} · ${resultStatus}` : '尚未运行'}</span></div>
        {result ? <>
          <textarea aria-label="AI 结果" readOnly={busy} className="text-area ai-result-text" value={result.content} onChange={(event) => setResult((current) => current ? { ...current, content: event.target.value } : current)} />
          <div className="ai-result-actions">
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(result.content)}><Clipboard size={13} />复制</Button>
            {resultApplication === 'builtin' ? <Button variant="outline" disabled={busy} title="使用左侧当前任务、要求和参考资料" onClick={() => void runAssistant()}>重新生成</Button> : null}
            <Button variant="outline" disabled={busy} onClick={() => { setResult(null); setRequestSelection(null) }}>取消</Button>
            {document && resultComplete && !busy ? selectionAction && requestSelection ? <><Button variant="outline" onClick={() => applySelectionResult('insert-after')}>插入选区后</Button><Button onClick={() => applySelectionResult('replace')}>替换选区</Button></> : resultApplication === 'analyze' ? null : <><Button onClick={() => applyResult('append')}>{resultApplication === 'generate' ? '插入后方' : '追加到正文'}</Button>{resultApplication === 'builtin' ? <Button variant="outline" onClick={() => applyResult('replace')}>替换当前正文</Button> : null}</> : null}
          </div>
        </> : <div className="ai-result-empty"><Sparkles size={26} /><strong>等待一次辅助任务</strong><span>在左侧选择任务和参考资料，结果将在这里显示。完成后可以编辑、复制或应用到正文。</span></div>}
      </Panel>
    </div>
    <div className="ai-connection-dialog"><Modal open={connectionOpen} title="Provider 连接设置" onClose={() => setConnectionOpen(false)}>
      <fieldset disabled={busy} className="ai-provider-fields">
        <Field label="名称"><TextInput value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="例如：本地 LM Studio" /></Field>
        <Field label="Base URL" hint="例如 http://127.0.0.1:1234/v1"><TextInput value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="留空使用本地离线模式" /></Field>
        <div className="field-grid"><Field label="Temperature"><TextInput type="number" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} /></Field><Field label="Max Tokens"><TextInput type="number" min="1" max="32000" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} /></Field></div>
        <Field label="API Key" hint="仅保留在当前窗口内，既不保存也不写入日志"><div className="input-with-action"><KeyRound size={14} color="var(--faint)" style={{ marginTop: 8 }} /><TextInput type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="可选；本地 Provider 通常不需要" autoComplete="off" /></div></Field>
      </fieldset>
    </Modal></div>
    <div className="ai-request-dialog"><Modal open={previewOpen} title="请求预览" onClose={() => setPreviewOpen(false)} footer={<><Button variant="outline" onClick={() => setPreviewOpen(false)}>返回编辑</Button><Button disabled={busy || contextBudget.overLimit || (mode === 'codex' && !codexReady)} onClick={() => { setPreviewOpen(false); void runAssistant() }}>确认运行</Button></>}>
      <div className="ai-preview-panel"><div className={'ai-context-budget' + (contextBudget.overLimit ? ' over' : '')}>System + User：{contextBudget.characters.toLocaleString()} 字符 · 预计 {contextBudget.estimatedTokens.toLocaleString()} Token · 安全阈值 {contextBudget.safeLimit.toLocaleString()} 字符{contextBudget.overLimit ? ' · 超过安全阈值，请减少选择' : ''}</div><h4>System Prompt</h4><pre>{SYSTEM_PROMPT}</pre><h4>User Prompt</h4><pre>{previewText}</pre></div>
    </Modal></div>
  </div>
}
