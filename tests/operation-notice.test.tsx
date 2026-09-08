import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { notify, useNotification } from '../src/lib/notifications'
import { OperationNotice } from '../src/components/OperationNotice'
import { useAppStore } from '../src/stores/app-store'
import { ContextMenuProvider } from '../src/components/ContextMenu'
import { TrashView } from '../src/components/TrashView'
const api = vi.hoisted(() => ({ listTrash: vi.fn() }))
vi.mock('../src/lib/api', () => ({ projectApi: api, isDesktop: false }))
beforeEach(() => { vi.clearAllMocks(); useAppStore.setState({ projectPath: 'p', projectSession: 12, trash: [], trashLoading: false, trashError: null }); useNotification.setState({ notice: null }) })
afterEach(cleanup)
it('keeps failed undo available to retry and hides it when the project changes', async () => {
  const undo = vi.fn().mockRejectedValueOnce(new Error('目标被占用')).mockResolvedValueOnce(undefined)
  notify({ message: '已移入回收站', session: 12, undo }); render(<OperationNotice />)
  fireEvent.click(screen.getByRole('button', { name: '撤销移入回收站' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('目标被占用'))
  fireEvent.click(screen.getByRole('button', { name: '撤销移入回收站' }))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  act(() => notify({ message: '旧项目通知', session: 12, undo })); act(() => useAppStore.setState({ projectSession: 13 }))
  expect(screen.queryByRole('status')).toBeNull()
})
it('distinguishes load errors from an empty trash and offers retry', async () => {
  api.listTrash.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce([])
  render(<ContextMenuProvider fallbackItems={[]}><TrashView /></ContextMenuProvider>)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('读取失败'))
  expect(screen.queryByText('回收站是空的')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重试加载' }))
  await waitFor(() => expect(screen.getByText('回收站是空的')).toBeTruthy())
})
