import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/components/Sidebar'
import { ContextMenuProvider } from '../src/components/ContextMenu'
import { projectApi } from '../src/lib/api'
import { useAppStore } from '../src/stores/app-store'
afterEach(cleanup)
it('keeps chapter opening separate from explicit menu actions and supports keyboard activation', async () => {
  const path = 'tree-actions-' + crypto.randomUUID()
  const data = await projectApi.create({ path, title: '章节操作回归', author: '', description: '', genre: '', targetWords: 1 })
  const chapter = data.nodes.find(node => node.kind === 'chapter')!
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: path, data })
  const move = vi.fn(), add = vi.fn(), copy = vi.fn()
  render(<ContextMenuProvider fallbackItems={[]}><Sidebar onAddNode={add} onMoveNode={move} onCopyNode={copy} onExportNode={() => {}} /></ContextMenuProvider>)
  fireEvent.click(screen.getByRole('button', { name: '第一卷' }))
  fireEvent.click(screen.getByRole('button', { name: /^第一章/ }))
  await waitFor(() => expect(useAppStore.getState().document?.node.id).toBe(chapter.id))
  expect(move).not.toHaveBeenCalled()
  expect(copy).not.toHaveBeenCalled()
  const menu = screen.getByRole('button', { name: '更多操作：第一章' })
  fireEvent.click(menu, { detail: 0 })
  expect(screen.getByRole('menu', { name: '第一章' })).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: '新建小节' }))
  expect(add).toHaveBeenCalledWith('section', chapter.id)
  fireEvent.click(menu)
  fireEvent.click(screen.getByRole('menuitem', { name: '移动到其他卷' }))
  expect(move).toHaveBeenCalledWith(chapter)
  fireEvent.contextMenu(screen.getByRole('button', { name: /^第一章/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '复制章节' }))
  expect(copy).toHaveBeenCalledWith(chapter)
})

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
