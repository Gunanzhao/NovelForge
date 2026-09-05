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
  version: string
  cliPath: string
  authMode: string
  planType: string | null
  ready: boolean
  rateLimits: { rateLimits?: { primary?: { usedPercent: number }; secondary?: { usedPercent: number } } } | null
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
  status: (cliPath: string) => invoke<CodexStatus>('codex_status', { cliPath }),
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
