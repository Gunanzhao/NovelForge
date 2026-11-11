import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectDialog } from '../src/components/ProjectDialogs'
import { useAppStore } from '../src/stores/app-store'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('creates an independent project then opens the existing import preview workflow', async () => {
  useAppStore.setState(useAppStore.getInitialState())
  const close = vi.fn()
  render(<ProjectDialog mode="import" onClose={close} />)
  fireEvent.change(screen.getByLabelText('项目文件夹'), { target: { value: 'import-entry-' + crypto.randomUUID() } })
  fireEvent.change(screen.getByLabelText('作品名'), { target: { value: '旧稿导入' } })
  expect(screen.getByText(/更多作品信息/).closest('details')?.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '创建项目并选择稿件' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(useAppStore.getState().data?.project.title).toBe('旧稿导入')
  expect(useAppStore.getState().activeView).toBe('manuscript-import')
})
it('does not navigate to import when project creation is cancelled', async () => {
  const create = vi.fn().mockResolvedValue(undefined), close = vi.fn()
  useAppStore.setState({ ...useAppStore.getInitialState(), createProject: create })
  render(<ProjectDialog mode="import" onClose={close} />)
  fireEvent.click(screen.getByRole('button', { name: '创建项目并选择稿件' }))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect(close).not.toHaveBeenCalled()
  expect(useAppStore.getState().activeView).not.toBe('manuscript-import')
})
