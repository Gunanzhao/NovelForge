import { create } from 'zustand'
import { codexApi, type CodexStatus } from '../lib/codex'

export interface CodexConfiguration { path: string; model: string; effort: string }
interface Session {
  configuration: CodexConfiguration | null
  status: CodexStatus | null
  error: string
  checking: boolean
  stage: string
  loginPending: boolean
  requestId: string | null
  loginId: string | null
  configure: (configuration: CodexConfiguration) => void
  refresh: (configuration: CodexConfiguration, force?: boolean) => Promise<void>
  cancel: () => Promise<void>
  login: (cancel: boolean) => Promise<void>
  invalidate: (message: string) => void
}

// Window memory only: navigation must not own the CLI check or its result.
// A new WebView starts unchecked; generation still validates the actual runtime.
export function matchesCodexConfiguration(session: Pick<Session, 'configuration' | 'status'>, configuration: CodexConfiguration) {
  const current = session.configuration
  return current?.path === configuration.path && (
    (current.model === configuration.model && current.effort === configuration.effort) ||
    (session.status?.ready && session.status.selectedModel === configuration.model && session.status.selectedEffort === configuration.effort)
  )
}
export function isCodexReady(session: Session, configuration: CodexConfiguration) {
  return Boolean(matchesCodexConfiguration(session, configuration) && session.status?.ready && session.status.compatibility?.state === 'passed' && !session.checking && !session.error)
}
export const useCodexSession = create<Session>((set, get) => ({
  configuration: null, status: null, error: '', checking: false, stage: '', loginPending: false, requestId: null, loginId: null,
  configure(configuration) {
    if (matchesCodexConfiguration(get(), configuration)) return
    const id = get().requestId
    set({ configuration, status: null, error: '', checking: false, stage: '', loginPending: false, requestId: null, loginId: null })
    if (id) void codexApi.cancelCheck(id).catch(() => {})
  },
  async refresh(configuration, force = false) {
    // Multiple mounted consumers share one check; navigation never restarts it.
    if (get().checking && matchesCodexConfiguration(get(), configuration)) return
    get().configure(configuration)
    const id = crypto.randomUUID()
    set({ configuration, requestId: id, checking: true, error: '', stage: 'discovery' })
    const valid = () => get().requestId === id
    try {
      const status = await codexApi.status(configuration.path, {
        requestId: id, model: configuration.model, effort: configuration.effort, force,
        isCancelled: () => !valid(), onProgress: stage => { if (valid()) set({ stage }) },
      })
      if (!valid()) return
      set({ status, error: status.compatibility?.diagnostic?.message ?? '', loginPending: status.authMode === 'chatgpt' ? false : get().loginPending })
    } catch (error) { if (valid()) set({ error: String(error) }) }
    finally { if (valid()) set({ requestId: null, checking: false }) }
  },
  async cancel() {
    const id = get().requestId
    if (!id) return
    set({ requestId: null, checking: false, error: '兼容检查已取消' })
    try { await codexApi.cancelCheck(id) } catch { /* Local invalidation also rejects late results. */ }
  },
  async login(cancel) {
    const configuration = get().configuration
    if (!configuration || get().checking) return
    const id = crypto.randomUUID()
    set({ loginId: id, checking: true, error: '', stage: 'account' })
    try {
      await codexApi.login(configuration.path, cancel)
      if (get().loginId === id) set({ loginPending: !cancel })
    } catch (error) { if (get().loginId === id) set({ error: String(error) }) }
    finally { if (get().loginId === id) set({ checking: false, loginId: null }) }
  },
  invalidate(message) { set({ error: message }) },
}))
