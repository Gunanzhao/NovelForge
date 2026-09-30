import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: {} }))
import { HistoryStorage } from '../src/components/HistoryStorage'
import { useAppStore } from '../src/stores/app-store'
const preview = { bodyBytes: 120, entityBytes: 40, batchBytes: 20, protectedCount: 3, fingerprint: 'exact-preview', candidates: [{ id: 'old', kind: 'body', label: '自动保存', bytes: 30 }] }
beforeEach(() => { vi.resetAllMocks(); useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: 'P' }); mocks.invoke.mockResolvedValue(preview) })
it('only mutates after preview and explicit confirmation, using the exact preview fingerprint', async () => {
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  render(<HistoryStorage projectPath="P" />)
  expect(mocks.invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('查看占用与清理预览'))
  const clean = await screen.findByText('确认清理上述旧自动历史')
  fireEvent.click(clean); expect(mocks.invoke).toHaveBeenCalledTimes(1)
  fireEvent.click(clean)
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('apply_history_cleanup', { path: 'P', fingerprint: 'exact-preview' }))
})
it('late errors from a different project session do not appear in the new session', async () => {
  let reject!: (error: Error) => void
  mocks.invoke.mockReturnValue(new Promise((_, no) => { reject = no }))
  render(<HistoryStorage projectPath="P" />)
  fireEvent.click(screen.getByText('查看占用与清理预览'))
  act(() => useAppStore.setState({ projectPath: 'Q', projectSession: 1 }))
  await act(async () => reject(new Error('old private error')))
  expect(screen.queryByText('old private error')).toBeNull()
})
