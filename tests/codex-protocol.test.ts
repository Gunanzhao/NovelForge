import { describe, expect, it, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('../src/lib/api', () => ({ isDesktop: true }))
import { codexApi } from '../src/lib/codex'
const input = { cliPath: '', requestId: 'current', model: 'writer', effort: 'low', systemPrompt: '小说助手', prompt: '续写' }
beforeEach(() => { vi.resetAllMocks(); mocks.listen.mockResolvedValue(mocks.unlisten) })
describe('Codex event lifecycle', () => {
  it('subscribes before starting, filters IDs and removes the listener after completion', async () => {
    let receive!: (event: unknown) => void
    mocks.listen.mockImplementation(async (_name, fn) => { receive = fn; return mocks.unlisten })
    mocks.invoke.mockImplementation(async () => {
      receive({ payload: { requestId: 'old', status: 'streaming', delta: '旧' } })
      receive({ payload: { requestId: 'current', status: 'streaming', delta: '新' } })
      return { content: '新', model: 'writer' }
    })
    const delta = vi.fn()
    await codexApi.generate(input, delta)
    expect(delta).toHaveBeenCalledExactlyOnceWith('新')
    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
    receive({ payload: { requestId: 'current', status: 'streaming', delta: '迟到' } })
    expect(delta).toHaveBeenCalledTimes(1)
  })
  it('does not start a task cancelled during subscription setup', async () => {
    await expect(codexApi.generate(input, vi.fn(), () => true)).rejects.toThrow('已取消')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
  })
  it('removes listeners on backend failure', async () => {
    mocks.invoke.mockRejectedValue(new Error('额度不足'))
    await expect(codexApi.generate(input, vi.fn())).rejects.toThrow('额度不足')
    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
  })
})
