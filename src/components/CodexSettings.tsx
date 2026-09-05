import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { isDesktop } from '../lib/api'
import { codexApi, type CodexModel, type CodexStatus } from '../lib/codex'
import { Button, Field, TextInput } from './ui'

interface Props {
  path: string; model: string; effort: string; busy: boolean
  onPath: (value: string) => void
  onModel: (value: string) => void
  onEffort: (value: string) => void
  onReady: (value: boolean) => void
}
export function CodexSettings({ path, model, effort, busy, onPath, onModel, onEffort, onReady }: Props) {
  const [status, setStatus] = useState<CodexStatus | null>(null)
  const [models, setModels] = useState<CodexModel[]>([])
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [loginPending, setLoginPending] = useState(false)
  const selected = models.find((m) => m.model === model)
  async function refresh() {
    setChecking(true); setError(''); onReady(false)
    try {
      const next = await codexApi.status(path)
      setStatus(next)
      if (next.ready) {
        const available = await codexApi.models(path)
        setModels(available)
        const choice = available.find((m) => m.model === model) ?? available[0]
        if (choice) {
          onModel(choice.model)
          if (!choice.supportedReasoningEfforts.some((e) => e.reasoningEffort === effort)) onEffort(choice.defaultReasoningEffort)
          onReady(true)
        }
        setLoginPending(false)
      }
    } catch (e) { setError(String(e)); setStatus(null) }
    finally { setChecking(false) }
  }
  async function login(cancel: boolean) {
    setChecking(true); setError('')
    try { await codexApi.login(path, cancel); setLoginPending(!cancel) }
    catch (e) { setError(String(e)) }
    finally { setChecking(false) }
  }
  async function choose() {
    const value = await open({ multiple: false, directory: false, title: '选择 Codex CLI', filters: [{ name: 'Codex CLI', extensions: ['exe', 'cmd', 'ps1'] }] })
    if (typeof value === 'string') { onPath(value); onReady(false); setStatus(null); setModels([]) }
  }
  if (!isDesktop) return <p role="status">Codex 接入需要 NovelForge 桌面版，不会在浏览器中模拟调用。</p>
  const locked = busy || checking || loginPending
  return <div>
    <p>实验性 Codex 接入 · 复用本机登录与订阅额度。登录状态与本机 Codex 共用。</p>
    <Field label="Codex CLI 路径" hint="留空自动检测官方 CLI，不执行启动脚本">
      <TextInput value={path} disabled={locked} onChange={(e) => { onPath(e.target.value); onReady(false); setStatus(null); setModels([]) }} />
    </Field>
    <Button variant="outline" disabled={locked} onClick={() => void choose().catch((e) => setError(String(e)))}>选择可执行文件</Button>
    <Button variant="outline" disabled={busy || checking} onClick={() => void refresh()}>检查连接 / 刷新登录</Button>
    {status ? <p role="status">CLI {status.version} · {status.authMode === 'chatgpt' ? `ChatGPT 已登录（${status.planType ?? '未知套餐'}）` : status.authMode === 'none' ? '尚未登录' : '当前不是 ChatGPT 订阅登录，不会回退到 API 计费'}</p> : null}
    {status?.authMode === 'none' && !loginPending ? <Button disabled={busy || checking} onClick={() => void login(false)}>登录 ChatGPT</Button> : null}
    {loginPending ? <p>请在浏览器完成登录，然后点击“刷新登录”。<Button disabled={checking || busy} onClick={() => void login(true)}>取消登录</Button></p> : null}
    <p>额度：{status?.rateLimits?.rateLimits?.primary ? `当前窗口已用 ${status.rateLimits.rateLimits.primary.usedPercent}%` : '暂不可用'}。使用额度与本机 Codex 共用。</p>
    <Field label="Codex 模型"><select className="select-input" value={selected ? model : ''} disabled={busy || checking || !models.length} onChange={(e) => {
      onModel(e.target.value)
      const next = models.find((m) => m.model === e.target.value)
      if (next) onEffort(next.defaultReasoningEffort)
    }}><option value="" disabled>检查连接后选择模型</option>{models.map((m) => <option key={m.model} value={m.model}>{m.displayName}</option>)}</select></Field>
    <Field label="推理强度"><select className="select-input" value={effort} disabled={busy || checking || !selected} onChange={(e) => onEffort(e.target.value)}>{selected?.supportedReasoningEfforts.map((e) => <option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}</select></Field>
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
