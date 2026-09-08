import { useCodexSession } from '../src/stores/codex-session'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CodexStatus } from '../src/lib/codex'
const mocks = vi.hoisted(() => ({ status: vi.fn(), cancelCheck: vi.fn(), login: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true }))
vi.mock('../src/lib/codex', () => ({ codexApi: mocks }))
import { CodexSettings } from '../src/components/CodexSettings'
const model = { model: 'writer', displayName: 'Writer', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }] }
function result(): CodexStatus {
  return { version: '0.153.4', cliPath: 'C:\\CLI\\codex.exe', authMode: 'chatgpt', planType: 'plus', ready: true,
    models: [model], selectedModel: 'writer', selectedEffort: 'low', rateLimits: [],
    compatibility: { state: 'passed', stage: 'complete', adapter: 'text-stdio-v1', checkedAt: 1700000000, cached: false, diagnostic: null } }
}
function props() { return { path: '', model: 'writer', effort: 'low', busy: false, onPath: vi.fn(), onModel: vi.fn(), onEffort: vi.fn(), onReady: vi.fn() } }
beforeEach(() => { useCodexSession.setState(useCodexSession.getInitialState(), true); vi.resetAllMocks(); mocks.cancelCheck.mockResolvedValue(undefined) })
afterEach(cleanup)
it('shows actual identity, cached verification and normalized rate limits', async () => {
  const report = result(); report.compatibility.cached = true
  report.rateLimits = [{ id: 'writing', name: '写作', windows: [{ name: 'primary', usedPercent: 0, windowDurationMins: 300, resetsAt: null }] }]
  mocks.status.mockResolvedValue(report)
  const input = props(); render(<CodexSettings {...input} />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  await screen.findByText(/CLI 0.153.4/)
  expect(screen.getByText(/C:\\CLI\\codex.exe/)).toBeTruthy()
  expect(screen.getByText(/使用有效验证缓存/)).toBeTruthy()
  expect(screen.getByText(/已用 0%/)).toBeTruthy()
  expect(input.onReady).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByText('重新验证'))
  await waitFor(() => expect(mocks.status.mock.calls[1][1].force).toBe(true))
})
it('retains login diagnostics while an unknown protocol blocks generation', async () => {
  const report = result(); report.ready = false; report.compatibility.state = 'unsupported'
  report.compatibility.diagnostic = { code: 'unsupported_protocol', stage: 'protocol', message: '权限字段已变化，请更新适配器', retryable: false }
  mocks.status.mockResolvedValue(report)
  const input = props(); render(<CodexSettings {...input} />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  await screen.findByRole('alert')
  expect(screen.getByText(/ChatGPT 已登录/)).toBeTruthy()
  expect(input.onReady).not.toHaveBeenCalledWith(true)
})
it('does not silently replace an unavailable saved model', async () => {
  const report = result(); report.ready = false; report.compatibility.state = 'failed'
  report.compatibility.diagnostic = { code: 'model_unavailable', stage: 'models', message: '所选模型已不可用，请重新选择模型', retryable: true }
  mocks.status.mockResolvedValue(report)
  const input = { ...props(), model: 'removed' }; render(<CodexSettings {...input} />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  await screen.findByText('所选模型已不可用，请重新选择模型')
  expect(input.onModel).not.toHaveBeenCalled()
  expect(input.onReady).not.toHaveBeenCalledWith(true)
})
it('cancels a pending check and discards its late successful response', async () => {
  let finish!: (value: CodexStatus) => void
  mocks.status.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const input = props(); render(<CodexSettings {...input} />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  const options = mocks.status.mock.calls[0][1]
  act(() => options.onProgress('verification'))
  expect(screen.getByText(/本地验证文本/)).toBeTruthy()
  fireEvent.click(screen.getByText('取消检查'))
  await act(async () => finish(result()))
  expect(mocks.cancelCheck).toHaveBeenCalledWith(options.requestId)
  expect(input.onReady).not.toHaveBeenCalledWith(true)
  expect(screen.getByRole('alert').textContent).toContain('取消')
})
it('rejects an old path but lets the current check finish after unmount', async () => {
  let finish!: (value: CodexStatus) => void
  mocks.status.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const input = props(); const view = render(<CodexSettings {...input} />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  view.rerender(<CodexSettings {...input} path="C:\\other\\codex.exe" />)
  await act(async () => finish(result()))
  expect(input.onReady).not.toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  view.unmount()
  await act(async () => finish(result()))
  expect(mocks.cancelCheck).toHaveBeenCalledTimes(1)
  expect(useCodexSession.getState().status?.ready).toBe(true)
  expect(input.onReady).not.toHaveBeenCalledWith(true)
})
it('keeps compact model selection and readiness when connection details are closed', async () => {
  mocks.status.mockResolvedValue(result())
  const input = props(); render(<CodexSettings {...input} compact />)
  expect(screen.queryByLabelText(/^Codex CLI 路径/)).toBeNull()
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  await screen.findByText('已连接')
  expect(screen.getByLabelText('Codex 模型')).toHaveProperty('value', 'writer')
  fireEvent.click(screen.getByRole('button', { name: '连接设置' }))
  expect(screen.getByLabelText(/^Codex CLI 路径/)).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText('已连接')).toBeTruthy()
  expect(mocks.status).toHaveBeenCalledTimes(1)
  expect(input.onReady).toHaveBeenLastCalledWith(true)
})

it('restores a successful connection on remount without another status request', async () => {
  mocks.status.mockResolvedValue(result())
  const input = props(); const view = render(<CodexSettings {...input} compact />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  await screen.findByText('已连接')
  view.unmount()
  const next = props(); render(<CodexSettings {...next} compact />)
  expect(screen.getByText('已连接')).toBeTruthy()
  expect(screen.getByLabelText('Codex 模型')).toHaveProperty('value', 'writer')
  expect(next.onReady).toHaveBeenLastCalledWith(true)
  expect(mocks.status).toHaveBeenCalledTimes(1)
})
it('shares a pending check and its progress after navigating away and back', async () => {
  let finish!: (value: CodexStatus) => void
  mocks.status.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<CodexSettings {...props()} compact />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  view.unmount()
  const options = mocks.status.mock.calls[0][1]
  act(() => options.onProgress('verification'))
  render(<CodexSettings {...props()} compact />)
  expect(screen.getByText(/本地验证文本/)).toBeTruthy()
  expect(mocks.cancelCheck).not.toHaveBeenCalled()
  await act(async () => finish(result()))
  expect(screen.getByText('已连接')).toBeTruthy()
  expect(mocks.status).toHaveBeenCalledTimes(1)
})
it('restores a model chosen by a check that finished while the view was absent', async () => {
  let finish!: (value: CodexStatus) => void
  mocks.status.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const input = { ...props(), model: '' }
  const view = render(<CodexSettings {...input} compact />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  view.unmount()
  await act(async () => finish(result()))
  render(<CodexSettings {...input} compact />)
  expect(input.onModel).toHaveBeenLastCalledWith('writer')
  expect(input.onReady).toHaveBeenLastCalledWith(true)
  expect(mocks.status).toHaveBeenCalledTimes(1)
})
it('invalidates readiness for changed parameters and never restores a cancelled check', async () => {
  mocks.status.mockResolvedValue(result())
  const input = props(); const view = render(<CodexSettings {...input} compact />)
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  await screen.findByText('已连接')
  view.rerender(<CodexSettings {...input} effort="high" compact />)
  expect(input.onReady).toHaveBeenLastCalledWith(false)
  expect(screen.queryByText('已连接')).toBeNull()
  let finish!: (value: CodexStatus) => void
  mocks.status.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByText('检查连接 / 刷新登录'))
  fireEvent.click(screen.getByText('取消检查'))
  view.unmount()
  await act(async () => finish(result()))
  render(<CodexSettings {...input} effort="high" compact />)
  expect(screen.getByRole('alert').textContent).toContain('取消')
  expect(screen.queryByText('已连接')).toBeNull()
})
