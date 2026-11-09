import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Sidebar } from '../src/components/Sidebar'
import { ContextMenuProvider } from '../src/components/ContextMenu'
import { projectApi } from '../src/lib/api'
import { useAppStore } from '../src/stores/app-store'
afterEach(cleanup)
it('makes import, memory and revision views reachable through real navigation buttons', async () => {
  const path = 'navigation-' + crypto.randomUUID()
  const data = await projectApi.create({ path, title: '导航回归', author: '', description: '', genre: '', targetWords: 1 })
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: path, data })
  render(<ContextMenuProvider fallbackItems={[]}><Sidebar onAddNode={() => {}} onMoveNode={() => {}} onCopyNode={() => {}} onExportNode={() => {}} /></ContextMenuProvider>)
  const details = screen.getByText('更多写作工具').closest('details')!
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')) })
  for (const [label, view] of [['稿件导入', 'manuscript-import'], ['章节记忆', 'chapter-memory'], ['批注与修订', 'annotation']]) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(useAppStore.getState().activeView).toBe(view))
  }
})

it('pins a secondary destination across remount without navigating away', async () => {
  localStorage.clear()
  const path = 'pins-' + crypto.randomUUID()
  const data = await projectApi.create({ path, title: '固定入口', author: '', description: '', genre: '', targetWords: 1 })
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: path, data, activeView: 'manuscript' })
  const sidebar = <ContextMenuProvider fallbackItems={[]}><Sidebar onAddNode={() => {}} onMoveNode={() => {}} onCopyNode={() => {}} onExportNode={() => {}} /></ContextMenuProvider>
  const first = render(sidebar)
  const details = screen.getByText('更多写作工具').closest('details')!
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')) })
  fireEvent.click(screen.getByRole('button', { name: '固定时间线' }))
  expect(useAppStore.getState().activeView).toBe('manuscript')
  expect(first.container.querySelector('.pinned-navigation')?.textContent).toContain('时间线')
  first.unmount()
  const second = render(sidebar)
  expect(second.container.querySelector('.pinned-navigation')?.textContent).toContain('时间线')
  fireEvent.click(screen.getByRole('button', { name: '取消固定时间线' }))
  expect(second.container.querySelector('.pinned-navigation')).toBeNull()
})
