import { describe, expect, it, vi } from 'vitest'
import { aiHttpConfirmationKey, confirmInsecureAiEndpoint } from '../src/lib/ai-security'

describe('AI Provider transport confirmation', () => {
  it.each([
    'http://localhost:1234/v1',
    'http://127.0.0.1:1234/v1',
    'http://127.1:1234/v1',
    'http://[::1]:1234/v1',
    'https://api.example.com/v1',
  ])('does not require confirmation for %s', (endpoint) => {
    expect(aiHttpConfirmationKey(endpoint)).toBeNull()
  })

  it('normalizes a remote HTTP endpoint into a stable confirmation key', () => {
    expect(aiHttpConfirmationKey(' HTTP://Example.com:80/v1/ ')).toBe('http://example.com/v1')
  })

  it('confirms a remote HTTP endpoint once per in-memory set and reconfirms after an address change', () => {
    const confirmed = new Set<string>()
    const confirm = vi.fn(() => true)

    expect(confirmInsecureAiEndpoint('http://example.com/v1', confirmed, confirm)).toBe(true)
    expect(confirmInsecureAiEndpoint('http://example.com/v1/', confirmed, confirm)).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)

    expect(confirmInsecureAiEndpoint('http://other.example/v1', confirmed, confirm)).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('does not remember a rejected confirmation', () => {
    const confirmed = new Set<string>()
    const confirm = vi.fn(() => false)

    expect(confirmInsecureAiEndpoint('http://example.com/v1', confirmed, confirm)).toBe(false)
    expect(confirmInsecureAiEndpoint('http://example.com/v1', confirmed, confirm)).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirmed.size).toBe(0)
  })
})
