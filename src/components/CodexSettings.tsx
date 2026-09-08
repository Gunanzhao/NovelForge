import { useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { isDesktop } from '../lib/api'
import { isCodexReady, matchesCodexConfiguration, useCodexSession } from '../stores/codex-session'
import { Button, Field, Modal, TextInput } from './ui'

interface Props {
  path: string; model: string; effort: string; busy: boolean
  onPath: (value: string) => void
  onModel: (value: string) => void
  onEffort: (value: string) => void
  onReady: (value: boolean) => void
  compact?: boolean
}
const stages: Record<string, string> = {
  discovery: '检测 CLI', account: '读取登录状态', models: '读取模型', configuration: '核对隔离配置',
  protocol: '匹配协议', verification: '本地验证文本、结束与取消行为', complete: '检查完成',
}
const states: Record<string, string> = { unchecked: '尚未验证', checking: '验证中', passed: '兼容检查通过', unsupported: '暂不支持此协议', failed: '兼容检查未通过' }
export function CodexSettings({ path, model, effort, busy, onPath, onModel, onEffort, onReady, compact = false }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const session = useCodexSession()
  const { status, error, checking, stage, loginPending, requestId, configure, login } = session
  const models = status?.models ?? []
  const mounted = useRef(true)
  const configuration = { path, model, effort }
  const connected = isCodexReady(session, configuration)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { configure({ path, model, effort }) }, [path, model, effort, configure])
  useEffect(() => {
    onReady(connected)
    if (connected && status) {
      if (model !== status.selectedModel) onModel(status.selectedModel)
      if (effort !== status.selectedEffort) onEffort(status.selectedEffort)
    }
  }, [connected, status, model, effort, onReady, onModel, onEffort])
  const selected = models.find((m) => m.model === model)
  const setError = session.invalidate
  const refresh = (force = false, nextModel = model, nextEffort = effort) => session.refresh({ path, model: nextModel, effort: nextEffort }, force)
  const cancelCheck = session.cancel
  function changePath(value: string) {
    configure({ path: value, model, effort }); onPath(value); onReady(false)
  }
  async function choose() {
    const original = useCodexSession.getState().configuration
    const value = await open({ multiple: false, directory: false, title: '选择 Codex CLI', filters: [{ name: 'Codex CLI', extensions: ['exe', 'cmd', 'ps1'] }] })
    if (mounted.current && original && matchesCodexConfiguration(useCodexSession.getState(), original) && typeof value === 'string') changePath(value)
  }
  if (!isDesktop) return <p role="status">Codex 接入需要 NovelForge 桌面版，不会在浏览器中模拟调用。</p>
  const locked = busy || checking || loginPending
  const selectors = <>    <Field label="Codex 模型"><select className="select-input" value={selected ? model : ''} disabled={busy || checking || !models.length} onChange={(e) => {
      const next = models.find((m) => m.model === e.target.value)
      if (next) { onReady(false); onModel(next.model); onEffort(next.defaultReasoningEffort); void refresh(false, next.model, next.defaultReasoningEffort) }
    }}><option value="" disabled>{models.length ? '请选择可用模型' : '检查连接后选择模型'}</option>{models.map((m) => <option key={m.model} value={m.model}>{m.displayName}</option>)}</select></Field>
    <Field label="推理强度"><select className="select-input" value={effort} disabled={busy || checking || !selected} onChange={(e) => { onReady(false); onEffort(e.target.value); void refresh(false, model, e.target.value) }}>{selected?.supportedReasoningEfforts.map((e) => <option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}</select></Field>
</>
  const details = <div>
    <p>复用本机 ChatGPT 登录与订阅额度。检查成功后在本窗口内保持状态，切换页面无需重复检查；生成前仍核验实际配置。本地兼容检查不消耗生成额度。</p>
    <Field label="Codex CLI 路径" hint="留空自动检测官方 CLI，不执行启动脚本">
      <TextInput value={path} disabled={locked} onChange={(e) => changePath(e.target.value)} />
    </Field>
    <div className="codex-check-actions">
      <Button variant="outline" disabled={locked} onClick={() => void choose().catch((e) => setError(String(e)))}>选择可执行文件</Button>
      <Button variant="outline" disabled={busy || checking} onClick={() => void refresh()}>检查连接 / 刷新登录</Button>
      <Button variant="outline" disabled={locked || !status} onClick={() => void refresh(true)}>重新验证</Button>
      {checking && requestId ? <Button variant="outline" onClick={() => void cancelCheck().catch((e) => setError(String(e)))}>取消检查</Button> : null}
    </div>
    {checking ? <p role="status">{stages[stage] ?? '正在检查'}… 最长 90 秒。</p> : null}
    {status ? <div className="codex-connection-status">
      <p>CLI {status.version ?? '版本未知'} · {status.authMode === 'chatgpt' ? `ChatGPT 已登录（${status.planType ?? '未知套餐'}）` : status.authMode === 'none' ? '尚未登录' : status.authMode === 'unknown' ? '登录状态暂不可用' : '当前不是 ChatGPT 订阅登录，不会回退到 API 计费'}</p>
      <p className="codex-resolved-path">检测路径：{status.cliPath}</p>
      <p role="status">{states[status.compatibility?.state] ?? '尚未验证'}{status.compatibility?.cached ? ' · 使用有效验证缓存' : ''}{status.compatibility?.checkedAt ? ` · ${new Date(status.compatibility.checkedAt * 1000).toLocaleString()}` : ''}</p>
    </div> : null}
    {status?.authMode === 'none' && !loginPending ? <Button disabled={busy || checking} onClick={() => void login(false)}>登录 ChatGPT</Button> : null}
    {loginPending ? <p>请在浏览器完成登录，然后点击“刷新登录”。<Button disabled={checking || busy} onClick={() => void login(true)}>取消登录</Button></p> : null}
    {status?.rateLimits?.some((bucket) => bucket.windows.length) ? status.rateLimits.map((bucket) => <p key={bucket.id}>额度（{bucket.name}）：{bucket.windows.map((window) => `${window.windowDurationMins ? `${window.windowDurationMins} 分钟窗口` : window.name === 'primary' ? '主要窗口' : '次要窗口'}已用 ${window.usedPercent}%`).join('；')}。与本机 Codex 共用。</p>) : <p>额度：暂不可用。使用额度与本机 Codex 共用。</p>}
    {!compact ? selectors : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
  if (!compact) return details
  return <div className="ai-codex-inline">
    {selectors}
    <span className={'ai-connection-state' + (connected ? ' is-ready' : '')} role="status">{checking ? stages[stage] ?? '正在检查' : connected ? '已连接' : status?.authMode === 'none' ? '待登录' : '待检查'}</span>
    {checking && requestId && !settingsOpen ? <Button variant="outline" onClick={() => void cancelCheck().catch((e) => setError(String(e)))}>取消检查</Button> : null}
    {!checking && !connected && !settingsOpen ? <Button variant="outline" disabled={busy || loginPending} onClick={() => void refresh()}>检查连接 / 刷新登录</Button> : null}
    <Button variant="outline" onClick={() => setSettingsOpen(true)}>连接设置</Button>
    {!settingsOpen && error ? <span className="ai-connection-error" role="alert">{error}</span> : null}
    <div className="ai-connection-dialog"><Modal open={settingsOpen} title="Codex 连接设置" onClose={() => setSettingsOpen(false)}>{details}</Modal></div>
  </div>
}
