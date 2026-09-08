import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isDesktop } from './api'
import type { AiCompletionResult } from './types'

export interface CodexModel {
  model: string
  displayName: string
  defaultReasoningEffort: string
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>
}
export interface CodexStatus {
  version: string | null
  cliPath: string
  authMode: string
  planType: string | null
  ready: boolean
  models: CodexModel[]
  selectedModel: string
  selectedEffort: string
  compatibility: {
    state: 'unchecked' | 'checking' | 'passed' | 'unsupported' | 'failed'
    stage: string
    adapter: string | null
    checkedAt: number | null
    cached: boolean
    diagnostic: { code: string; stage: string; message: string; retryable: boolean } | null
  }
  rateLimits: Array<{ id: string; name: string; windows: Array<{ name: string; usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }> }>
}
export interface CodexCheckOptions {
  requestId?: string; model?: string; effort?: string; force?: boolean
  onProgress?: (stage: string) => void
  isCancelled?: () => boolean
}
export interface CodexInput {
  cliPath: string
  requestId: string
  model: string
  effort: string
  systemPrompt: string
  prompt: string
}
export const codexApi = {
  async status(cliPath: string, options: CodexCheckOptions = {}): Promise<CodexStatus> {
    const requestId = options.requestId ?? crypto.randomUUID()
    let accepting = true
    const unlisten = await listen<{ requestId: string; stage: string }>('codex-check', ({ payload }) => {
      if (accepting && payload.requestId === requestId && !options.isCancelled?.()) options.onProgress?.(payload.stage)
    })
    try {
      if (options.isCancelled?.()) throw new Error('兼容检查已取消')
      return await invoke<CodexStatus>('codex_status', { cliPath, requestId, model: options.model ?? '', effort: options.effort ?? '', force: options.force ?? false })
    } finally { accepting = false; unlisten() }
  },
  cancelCheck: (requestId: string) => invoke<void>('codex_check_cancel', { requestId }),
  models: (cliPath: string) => invoke<CodexModel[]>('codex_models', { cliPath }),
  login: (cliPath: string, cancel = false) => invoke<{ authUrl: string } | null>('codex_login', { cliPath, cancel }),
  cancel: (requestId: string) => invoke<void>('codex_cancel', { requestId }),
  async generate(input: CodexInput, onDelta: (text: string) => void, isCancelled = () => false): Promise<AiCompletionResult> {
    if (!isDesktop) throw new Error('Codex 接入需要 NovelForge 桌面版。')
    let accepting = true
    const unlisten = await listen<{ requestId: string; status: string; delta: string }>('codex-generation', ({ payload }) => {
      if (accepting && payload.requestId === input.requestId && payload.status === 'streaming') onDelta(payload.delta)
    })
    try {
      if (isCancelled()) throw new Error('生成已取消')
      return await invoke<AiCompletionResult>('codex_generate', { input })
    }
    finally { accepting = false; unlisten() }
  },
}
