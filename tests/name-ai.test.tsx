import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ aiComplete: vi.fn(), status: vi.fn(), cancelCheck: vi.fn(async () => {}), generate: vi.fn(), cancel: vi.fn(async () => {}) }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: { aiComplete: mocks.aiComplete } }))
vi.mock('../src/lib/codex', () => ({ codexApi: mocks }))
import { NameAiPanel } from '../src/components/NameAiPanel'
import { useAppStore } from '../src/stores/app-store'
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); useAppStore.setState(useAppStore.getInitialState()) })
afterEach(cleanup)
function setup(onResults = vi.fn()) {
  render(<NameAiPanel category="character" style="中文古风" count={2} rules={{ surname: '林', excluded: '月' }} excluded={['林清']} onResults={onResults} />)
  fireEvent.change(screen.getByLabelText('Provider 地址'), { target: { value: 'https://example.com/v1' } })
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'test-model' } })
  return onResults
}
it('sends explicit context and filters invalid, duplicate and excluded names', async () => {
  mocks.aiComplete.mockResolvedValue({ content: '[{"name":"林舟","explanation":"远航意象"},{"name":"林舟"},{"name":"林月"},{"name":"林清"},{"name":"王云"}]' })
  const onResults = setup()
  fireEvent.change(screen.getByLabelText('世界观、人物背景与命名意象'), { target: { value: '海洋文明' } })
  fireEvent.click(screen.getByRole('button', { name: '发送并生成 AI 名字' }))
  await waitFor(() => expect(onResults).toHaveBeenCalledTimes(1))
  expect(onResults.mock.calls[0][0]).toEqual([{ name: '林舟', explanation: '远航意象', category: 'character', style: '中文古风' }])
  expect(JSON.parse(mocks.aiComplete.mock.calls[0][0].prompt).context).toEqual([])
  expect(mocks.aiComplete.mock.calls[0][0].prompt).toContain('海洋文明')
})
it('reports malformed output without overwriting results', async () => {
  mocks.aiComplete.mockResolvedValue({ content: 'invalid json' })
  const onResults = setup()
  fireEvent.click(screen.getByRole('button', { name: '发送并生成 AI 名字' }))
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
  expect(onResults).not.toHaveBeenCalled()
})
it('discards a provider reply after cancellation', async () => {
  let resolve!: (value: { content: string }) => void
  mocks.aiComplete.mockReturnValue(new Promise(value => { resolve = value }))
  const onResults = setup()
  fireEvent.click(screen.getByRole('button', { name: '发送并生成 AI 名字' }))
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
  await act(async () => resolve({ content: '[{"name":"林舟"}]' }))
  expect(onResults).not.toHaveBeenCalled()
})
it('uses configured Codex and cancels on unmount', async () => {
  mocks.status.mockResolvedValue({ ready: true, selectedModel: 'configured-model', selectedEffort: 'low' }); mocks.generate.mockReturnValue(new Promise(() => {}))
  localStorage.setItem('novelforge:ai-preferences:v1', JSON.stringify({ mode: 'codex', codexPath: 'custom-codex', codexModel: 'configured-model' }))
  const { unmount } = render(<NameAiPanel category="character" style="中文古风" count={2} rules={{}} excluded={[]} onResults={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '发送并生成 AI 名字' }))
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1))
  expect(mocks.generate.mock.calls[0][0].model).toBe('configured-model')
  unmount(); expect(mocks.cancel).toHaveBeenCalledTimes(1)
})
it('keeps connection and context inputs when conditions invalidate a pending request', async () => {
  let resolve!: (value: { content: string }) => void
  mocks.aiComplete.mockReturnValue(new Promise(value => { resolve = value }))
  const onResults = vi.fn()
  const props = { category: 'character' as const, style: '中文古风' as const, count: 2, rules: {}, excluded: [], onResults }
  const { rerender } = render(<NameAiPanel {...props} revision="before" />)
  fireEvent.change(screen.getByLabelText('Provider 地址'), { target: { value: 'https://example.com/v1' } })
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'test-model' } })
  fireEvent.change(screen.getByLabelText('世界观、人物背景与命名意象'), { target: { value: '保留背景' } })
  fireEvent.click(screen.getByRole('button', { name: '发送并生成 AI 名字' }))
  rerender(<NameAiPanel {...props} revision="after" />)
  expect((screen.getByLabelText('世界观、人物背景与命名意象') as HTMLTextAreaElement).value).toBe('保留背景')
  expect((screen.getByLabelText('Provider 地址') as HTMLInputElement).value).toBe('https://example.com/v1')
  await act(async () => resolve({ content: '[{"name":"林舟"}]' }))
  expect(onResults).not.toHaveBeenCalled()
})
