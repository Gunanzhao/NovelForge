import { describe, expect, it } from 'vitest'
import { buildAiPrompt, localAssist, readAiPreferences, writeAiPreferences } from '../src/lib/ai-data'

describe('AI context helpers', () => {
  it('builds an explicit context prompt and local fallback without a key', () => {
    const prompt = buildAiPrompt('continue', [{ title: '第一章', kind: '正文', content: '林月走进雾港。' }], '保持第一人称')
    expect(prompt).toContain('明确选中的上下文')
    expect(prompt).toContain('林月走进雾港')
    const local = localAssist('summary', [{ title: '第一章', kind: '正文', content: '林月走进雾港。' }], '')
    expect(local.model).toBe('novelforge-local')
    expect(local.localContent).toContain('本地摘要草稿')
    expect(local.apiKey).toBe('')
  })

  it('persists endpoint/model preferences but has no API key field', () => {
    writeAiPreferences({ endpoint: 'http://127.0.0.1:1234/v1', model: 'local-model' })
    const preferences = readAiPreferences()
    expect(preferences).toEqual({ endpoint: 'http://127.0.0.1:1234/v1', model: 'local-model' })
    expect(JSON.stringify(localStorage)).not.toContain('apiKey')
  })
})

