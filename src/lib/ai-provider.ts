import type { AiPreferences } from './ai-data'
import type { AiCompletionInput, AiUsage } from './types'

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro']

export function providerKind(
  preferences: Pick<AiPreferences, 'endpoint' | 'providerKind'>,
) {
  if (preferences.providerKind) return preferences.providerKind
  try {
    return new URL(preferences.endpoint).hostname === 'api.deepseek.com'
      ? 'deepseek'
      : 'compatible'
  } catch {
    return 'compatible'
  }
}

export function providerTokenLimit(preferences: AiPreferences) {
  return providerKind(preferences) === 'deepseek' ? 65_536 : 32_000
}

export function deepseekPreset(preferences: AiPreferences): AiPreferences {
  return {
    ...preferences,
    mode: 'provider',
    providerKind: 'deepseek',
    providerName: 'DeepSeek',
    endpoint: DEEPSEEK_ENDPOINT,
    model: DEEPSEEK_MODELS[0],
    thinking: 'disabled',
    reasoningEffort: 'high',
    maxTokens: 8192,
    temperature: 0.7,
    stream: true,
    timeoutSeconds: 300,
  }
}

export function providerRequest(
  preferences: AiPreferences,
  apiKey: string,
  systemPrompt: string,
  prompt: string,
): AiCompletionInput {
  const deepseek = providerKind(preferences) === 'deepseek'
  if (deepseek && !apiKey.trim()) throw new Error('请填写 DeepSeek API Key。')
  const requested = preferences.maxTokens ?? (deepseek ? 8192 : 4000)
  const timeout = preferences.timeoutSeconds ?? (deepseek ? 300 : 120)
  return {
    endpoint: preferences.endpoint,
    model: preferences.model,
    apiKey,
    systemPrompt,
    prompt,
    temperature: preferences.temperature ?? 0.7,
    maxTokens: Math.max(
      1,
      Math.min(
        providerTokenLimit(preferences),
        Number.isFinite(requested) ? Math.round(requested) : 4000,
      ),
    ),
    ...(deepseek
      ? {
          providerKind: 'deepseek',
          thinking: preferences.thinking ?? 'disabled',
          reasoningEffort: preferences.reasoningEffort ?? 'high',
        }
      : preferences.providerKind
        ? { providerKind: preferences.providerKind }
        : {}),
    stream: preferences.stream ?? deepseek,
    timeoutSeconds: Math.max(
      30,
      Math.min(600, Number.isFinite(timeout) ? Math.round(timeout) : 120),
    ),
  }
}

export function usageLabel(usage?: AiUsage) {
  if (!usage) return ''
  return (
    [
      usage.promptTokens != null
        ? `输入 ${usage.promptTokens.toLocaleString()}`
        : '',
      usage.completionTokens != null
        ? `输出 ${usage.completionTokens.toLocaleString()}`
        : '',
      usage.reasoningTokens != null
        ? `其中思考 ${usage.reasoningTokens.toLocaleString()}`
        : '',
      usage.cachedTokens != null
        ? `缓存命中 ${usage.cachedTokens.toLocaleString()}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ') + ' Token'
  )
}
