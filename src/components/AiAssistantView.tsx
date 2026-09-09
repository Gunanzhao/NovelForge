import { attachmentContextText } from '../lib/attachment-data'
import { parseTemperature } from '../lib/ai-data'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clipboard, Eye, KeyRound, Send, Sparkles, TriangleAlert } from 'lucide-react'
import { projectApi } from '../lib/api'
import { aiHttpConfirmationKey, confirmInsecureAiEndpoint } from '../lib/ai-security'
import {
  AI_ACTIONS, buildAiPrompt, contextItems, estimateContextBudget,
  isSelectionAction, localAssist, recentChapterIds, readAiPreferences, writeAiPreferences,
} from '../lib/ai-data'
import type { AiAction, AiContextItem } from '../lib/ai-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Modal, Panel, TextInput } from './ui'
import { PromptPresetManager } from './PromptPresetManager'
import { CodexSettings } from './CodexSettings'
import { captureAiTarget, useAiTask, type AiTarget, type AiRequest } from '../stores/ai-task'
import { mapAiRange, textChanges } from '../lib/ai-edit'
import { AiReview } from './AiReview'
import type { AiPreferences } from '../lib/ai-data'
import type { PromptPreset, PromptPresetAction, PromptResolution } from '../lib/prompt-preset'

const SYSTEM_PROMPT = '你是 NovelForge 的中文小说创作助手。只处理用户明确选中的上下文，不擅自引入未提供的事实。'
const PRESET_SYSTEM_PROMPT = '你是 NovelForge 的中文小说创作助手。只处理模板中明确引用的上下文。'

export function AiAssistantView({ compact = false, visible = true, onExpand, onDismiss }: { compact?: boolean; visible?: boolean; onExpand?: () => void; onDismiss?: () => void }) {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const projectSession = useAppStore(state => state.projectSession)
  const document = useAppStore((state) => state.document)
  const editorSelection = useAppStore((state) => state.editorSelection)
  const requestedAiAction = useAppStore((state) => state.requestedAiAction)
  const consumeAiAction = useAppStore((state) => state.consumeAiAction)
  const setError = useAppStore((state) => state.setError)
  const preferences = useMemo(() => readAiPreferences(), [])
  const [mode, setMode] = useState<NonNullable<AiPreferences['mode']>>(preferences.mode ?? 'offline')
  const [codexPath, setCodexPath] = useState(preferences.codexPath ?? '')
  const [codexModel, setCodexModel] = useState(preferences.codexModel ?? '')
  const [codexEffort, setCodexEffort] = useState(preferences.codexEffort ?? 'low')
  const [codexReady, setCodexReady] = useState(false)
  const task = useAiTask()
  const { result } = task
  const busy = task.phase === 'preparing' || task.phase === 'running'
  const resultComplete = task.phase === 'complete'
  const resultStatus = { idle: '已应用', preparing: '准备上下文', running: '生成中', complete: '已完成', cancelled: '已停止 · 结果未完成', failed: '生成失败 · 结果未完成' }[task.phase]
  const [draftTarget, setDraftTarget] = useState<AiTarget | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
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
  const [previewOpen, setPreviewOpen] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [resultApplication, setResultApplication] = useState<'builtin' | PromptPresetAction>('builtin')
  const confirmedHttpProviders = useRef(new Set<string>())
  const instructionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setDraftTarget(null); setInstruction(''); setSelectedIds(new Set()); setLoadedContext([]); setPreviewOpen(false) }, [projectSession])

  function chooseTask(next: AiAction) {
    setAction(next)
    if (compact || draftTarget || useAppStore.getState().activeView === 'manuscript') {
      try {
        const kind = isSelectionAction(next) ? 'selection' : ['summary', 'chapter-summary', 'outline', 'setting-advice'].includes(next) ? 'chapter' : 'cursor'
        setDraftTarget(captureAiTarget(kind)); setSelectedIds(new Set(['ai-target']))
      } catch (error) { setError(error) }
    }
  }
  useEffect(() => {
    if (!requestedAiAction) return
    setAction(requestedAiAction)
    try {
      const inline = useAppStore.getState().activeView === 'manuscript'
      const kind = isSelectionAction(requestedAiAction) ? 'selection' : inline && !['summary', 'chapter-summary', 'outline', 'setting-advice'].includes(requestedAiAction) ? 'cursor' : 'chapter'
      setDraftTarget(captureAiTarget(kind)); setSelectedIds(new Set(['ai-target']))
    } catch (error) { setError(error) }
    window.requestAnimationFrame(() => instructionRef.current?.focus())
    consumeAiAction()
  }, [consumeAiAction, requestedAiAction, setError])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!visible || event.key !== 'Escape' || [...globalThis.document.querySelectorAll('[role="dialog"]')].some(dialog => !dialog.closest('[hidden],[inert]'))) return
      if (compact) { onDismiss?.(); return }
      if (useAiTask.getState().id) useAiTask.getState().stop()
      else useAiTask.getState().clear()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [compact, visible, onDismiss])
  useEffect(() => {
    if (draftTarget && (draftTarget.project !== projectPath || draftTarget.node !== document?.node.id)) { setDraftTarget(null); setSelectedIds(new Set()) }
  }, [projectPath, document?.node.id, draftTarget])
  const targetContext = useMemo(() => draftTarget ? {
    id: 'ai-target', kind: 'paragraph' as const, title: draftTarget.kind === 'selection' ? '本次原选区' : draftTarget.kind === 'cursor' ? '原光标前文（最多 4,000 字符）' : '本次章节',
    detail: draftTarget.title, nodeId: draftTarget.node,
    range: { from: draftTarget.kind === 'cursor' ? Math.max(0, draftTarget.from - 4000) : draftTarget.from, to: draftTarget.to },
  } : null, [draftTarget])
  const items = useMemo(() => data ? [...(targetContext ? [targetContext] : []), ...contextItems(data.nodes, data.entities, document?.node.id, document?.content, targetContext ? null : editorSelection)] : [], [data, document?.content, document?.node.id, editorSelection, targetContext])
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
      if (!next.size && document) next.add(targetContext ? 'ai-target' : document.node.id)
      const selectionItem = items.find((item) => item.kind === 'selection')
      if (selectionItem && editorSelection?.text.trim()) next.add(selectionItem.id)
      return next
    })
  }, [document, editorSelection, items, targetContext])

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

  function resolveTarget() {
    if (!draftTarget) return captureAiTarget(isSelectionAction(action) ? 'selection' : compact ? 'cursor' : 'chapter')
    const current = useAppStore.getState()
    if (current.projectPath !== draftTarget.project || current.projectSession !== draftTarget.session || current.document?.node.id !== draftTarget.node) throw new Error('目标章节已切换，请重新选择目标。')
    const content = current.document.content
    const range = mapAiRange(draftTarget, textChanges(draftTarget.originalContent, content))
    if (range.conflict) throw new Error('准备的目标正文已变化，请点击“使用当前选区/光标”重新定位。')
    return captureAiTarget(draftTarget.kind, range)
  }
  function request(systemPrompt: string, prompt: string, local: AiRequest['local']): AiRequest {
    if (mode === 'codex' && !codexReady) throw new Error('请在桌面版检查 Codex 连接并完成 ChatGPT 登录。')
    return { systemPrompt, prompt, local, apiKey, preferences: {
      mode, codexPath, codexModel, codexEffort, endpoint, model, providerName,
      temperature: parseTemperature(temperature), maxTokens: Math.max(1, Math.min(32000, Number.parseInt(maxTokens, 10) || 4000)),
    } }
  }
  function canSend() {
    return mode !== 'provider' || confirmInsecureAiEndpoint(endpoint, confirmedHttpProviders.current, message => window.confirm(message))
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
    if (item.id === 'ai-target' && draftTarget && targetContext) {
      return draftTarget.originalContent.slice(targetContext.range.from, targetContext.range.to)
    }
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
    const current = useAppStore.getState()
    if (current.projectSession !== projectSession || current.projectPath !== currentProjectPath || current.document?.node.id !== document?.node.id) throw new Error('项目或章节已切换，请重新选择上下文。')
    setLoadedContext(context)
    return context
  }

  async function runAssistant(outputLimit?: number) {
    if (busy || !canSend()) return
    if (!selectedItems.length) { setError('请至少选择一项上下文，再运行 AI 辅助。'); return }
    try {
      const target = resolveTarget()
      if (isSelectionAction(action) && target.kind !== 'selection') throw new Error('当前任务需要先在编辑器中选中一段正文。')
      setResultApplication('builtin'); setReviewOpen(false)
      await task.start(target, isSelectionAction(action) ? 'rewrite' : 'generate', async () => {
        const context = await loadSelectedContext()
        const prompt = buildAiPrompt(action, context, instruction)
        const local = localAssist(action, context, instruction)
        const prepared = request(SYSTEM_PROMPT, prompt, { content: local.localContent, model: local.model })
        if (outputLimit) prepared.preferences.maxTokens = outputLimit
        return prepared
      })
    } catch (error) { setError(error) }
  }
  async function runPreset(preset: PromptPreset, resolution: PromptResolution, isCurrentSource: () => boolean) {
    if (!isCurrentSource()) { setError('模板上下文已变化，请重新预览。'); return }
    if (busy || !canSend()) return
    try {
      const target = preset.action === 'rewrite' ? captureAiTarget('selection') : resolveTarget()
      setResultApplication(preset.action); setReviewOpen(false)
      await task.start(target, preset.action === 'rewrite' ? 'rewrite' : preset.action === 'analyze' ? 'analyze' : 'generate', async () => request(preset.systemPrompt ?? PRESET_SYSTEM_PROMPT, resolution.prompt, { content: `【本地模板草稿】\n\n${resolution.prompt}`, model: 'novelforge-local' }))
    } catch (error) { setError(error) }
  }
  async function showPreview() {
    if (!selectedItems.length) { setError('请至少选择一项上下文。'); return }
    try { await loadSelectedContext(); setPreviewOpen(true) } catch (error) { setError(error) }
  }
  const selectionReady = Boolean(editorSelection && document && editorSelection.nodeId === document.node.id && editorSelection.to > editorSelection.from && editorSelection.text.trim())
  const selectionAction = task.application === 'rewrite'
  const targetCurrent = task.target?.project === projectPath && task.target?.node === document?.node.id && task.target?.session === useAppStore.getState().projectSession
  function applyResult(mode: 'replace' | 'append') {
    if (mode === 'replace') {
      if (window.confirm('这会用 AI 结果覆盖原目标正文，是否继续？')) task.replace()
    } else task.insert(task.target?.kind === 'cursor' ? 'target' : 'end')
  }
  const previewText = buildAiPrompt(action, loadedContext, instruction)
  const contextBudget = estimateContextBudget([{ title: 'system', kind: 'system', content: SYSTEM_PROMPT }, { title: 'user', kind: 'user', content: previewText }])
  const insecureHttpProvider = aiHttpConfirmationKey(endpoint) !== null
  const quickActions: AiAction[] = ['continue', 'polish', 'summary']
  const connectionLocked = busy
  return <div className={'workspace-view ai-view ai-workbench' + (compact ? ' ai-inline-workbench' : '')}>
    <div className="view-header ai-workbench-header"><div><p className="eyebrow">WRITING ASSISTANT</p><h1>AI 辅助</h1></div><span className="ai-workbench-subtitle">选择资料与任务，预览后应用结果</span>{compact ? <div className="ai-inline-nav"><Button variant="ghost" onClick={onExpand}>完整工作台</Button><Button variant="ghost" onClick={onDismiss}>收起</Button></div> : null}</div>
    <div className="ai-connection-bar" aria-label="AI 连接">
      <Field label="AI 模式"><select aria-label="AI 模式" className="select-input" value={mode} disabled={connectionLocked} onChange={(e) => { setMode(e.target.value as NonNullable<AiPreferences['mode']>); setCodexReady(false); task.clear(); setConnectionOpen(false) }}><option value="offline">本地离线</option><option value="provider">兼容 Provider</option><option value="codex">Codex 订阅（实验性）</option></select></Field>
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
            {AI_ACTIONS.filter((item) => quickActions.includes(item.id)).map((item) => <Button key={item.id} variant="ghost" aria-pressed={action === item.id} disabled={busy} onClick={() => chooseTask(item.id)}>{item.label}</Button>)}
            <select aria-label="更多任务" className="select-input" value={quickActions.includes(action) ? '' : action} disabled={busy} onChange={(event) => chooseTask(event.target.value as AiAction)}><option value="" disabled>更多任务</option>{AI_ACTIONS.filter((item) => !quickActions.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </div>
          <p className="ai-task-description">{AI_ACTIONS.find((item) => item.id === action)?.description}{isSelectionAction(action) ? '。仅处理选区；如需处理整章，请先在编辑器中全选正文。' : ''}</p>
          {compact || draftTarget ? <div className="ai-target-summary"><strong>{draftTarget ? `${draftTarget.title} · ${draftTarget.kind === 'selection' ? '原选区' : draftTarget.kind === 'cursor' ? '原光标' : '整章'}` : '当前正文'}</strong><Button variant="outline" disabled={busy} onClick={() => { try { setDraftTarget(captureAiTarget(selectionReady ? 'selection' : 'cursor')); setSelectedIds(new Set(['ai-target'])) } catch (error) { setError(error) } }}>使用当前选区/光标</Button><Button variant="ghost" disabled={busy || isSelectionAction(action)} title={isSelectionAction(action) ? '此任务仅处理选区；如需处理整章，请先在编辑器中全选正文。' : undefined} onClick={() => { try { setDraftTarget(captureAiTarget('chapter')); setSelectedIds(new Set(['ai-target'])) } catch (error) { setError(error) } }}>使用整章</Button></div> : null}
          <Field label="写作要求"><textarea ref={instructionRef} className="text-area ai-instruction-input" disabled={busy} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：保持第一人称，增加悬念，不改变已有设定…" /></Field>
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
          <div className="ai-action-buttons"><Button variant="outline" disabled={busy} onClick={() => void showPreview()}><Eye size={14} />预览上下文</Button><Button disabled={busy || (mode === 'codex' && !codexReady)} onClick={() => void runAssistant()}><Send size={14} />{busy ? '处理中…' : '运行辅助'}</Button>{busy ? <Button variant="outline" onClick={task.stop}>{mode === 'provider' ? '停止接收' : '停止生成'}</Button> : null}</div>
          {mode === 'codex' && !codexReady && !busy ? <span className="ai-context-hint">请先检查连接并完成登录</span> : null}
        </div>
      </Panel>
      <Panel className="ai-output-panel" aria-label="AI 结果工作区">
        {!result && task.error ? <div className="ai-task-error" role="alert"><p>{task.error}</p><Button variant="outline" disabled={busy} onClick={() => setConnectionOpen(true)}>调整连接设置</Button>{mode === 'provider' && resultApplication === 'builtin' && task.error.includes('输出上限耗尽') && Number(maxTokens) < 32000 ? <Button disabled={busy} onClick={() => { const next = Math.min(32000, Math.max(4096, (Number.parseInt(maxTokens, 10) || 4000) * 2)); setMaxTokens(String(next)); void runAssistant(next) }}>提高上限至 {Math.min(32000, Math.max(4096, (Number.parseInt(maxTokens, 10) || 4000) * 2))} 并重试</Button> : null}</div> : null}
        <div className="panel-title ai-output-heading"><h3>AI 结果</h3><span role="status">{result ? `${result.model} · ${resultStatus}` : task.phase === 'idle' ? '尚未运行' : resultStatus}</span></div>
        {result ? <>
          {selectionAction && resultComplete ? <div className="ai-result-tabs"><Button variant="ghost" aria-pressed={!reviewOpen} onClick={() => setReviewOpen(false)}>生成结果</Button><Button variant="ghost" aria-pressed={reviewOpen} onClick={() => setReviewOpen(true)}>修改对比 · {task.edits.length}</Button></div> : null}
          {reviewOpen && selectionAction && resultComplete ? <AiReview /> : <textarea aria-label="AI 结果" readOnly={!resultComplete || task.edits.some(edit => edit.state === 'accepted')} className="text-area ai-result-text" value={result.content} onChange={(event) => task.editResult(event.target.value)} />}
          {task.target ? <div className="ai-result-target">目标：{task.target.title}{!targetCurrent ? ' · 当前章节不同，结果只可查看或复制' : ''}</div> : null}
          {task.edits.some(edit => edit.state === 'pending' && edit.conflict) && targetCurrent && selectionAction ? <p className="ai-task-error">正文已变化，请在修改对比中逐项检查；未冲突的修改仍可接受。</p> : null}
          {task.error ? <p className="ai-task-error" role="alert">{task.error}</p> : null}
          <div className="ai-result-actions">
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(result.content)}><Clipboard size={13} />复制</Button>
            {resultApplication === 'builtin' ? <Button variant="outline" disabled={busy} title="使用左侧当前任务、要求和参考资料" onClick={() => void runAssistant()}>重新生成</Button> : null}
            <Button variant="outline" disabled={busy} onClick={task.clear}>取消</Button>
            {document && resultComplete && !busy ? selectionAction ? <><Button variant="outline" disabled={!targetCurrent || task.target?.conflict} onClick={() => task.insert('after')}>插入选区后</Button><Button disabled={!targetCurrent || !task.edits.some(edit => edit.state === 'pending') || task.edits.some(edit => edit.state === 'pending' && edit.conflict)} onClick={() => task.accept()}>替换选区</Button></> : task.application === 'analyze' ? null : <><Button disabled={!targetCurrent} onClick={() => applyResult('append')}>{task.target?.kind === 'cursor' ? '插入原光标处' : resultApplication === 'generate' ? '插入后方' : '追加到正文'}</Button>{resultApplication === 'builtin' && task.target?.kind === 'chapter' ? <Button variant="outline" disabled={!targetCurrent} onClick={() => applyResult('replace')}>替换当前正文</Button> : null}</> : null}
          </div>
        </> : <div className="ai-result-empty"><Sparkles size={26} /><strong>{task.phase === 'failed' ? '本次生成失败' : busy ? '正在等待模型返回正文' : task.phase === 'cancelled' ? '已停止接收结果' : '等待一次辅助任务'}</strong><span>{busy ? '可以继续编辑正文或切换页面；思考模型可能需要较长时间。' : task.phase === 'failed' ? '请按上方提示调整后重试，原文未被覆盖。' : '在左侧选择任务和参考资料，结果将在这里显示。完成后可以编辑、复制或应用到正文。'}</span></div>}
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
