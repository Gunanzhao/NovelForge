import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), unlisten: vi.fn(), copy: vi.fn(), listener: undefined as (() => void) | undefined }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_: string, handler: () => void) => { mocks.listener = handler; return mocks.unlisten }) }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: {} }))
vi.mock('../src/lib/clipboard', () => ({ writeClipboardText: mocks.copy }))
import { useAppStore } from '../src/stores/app-store'
import { registerDraft, decideDraftNavigation, useDraftGuard } from '../src/lib/draft-guard'
import { WindowCloseGuard } from '../src/components/WindowCloseGuard'
beforeEach(() => {
  vi.resetAllMocks(); mocks.invoke.mockResolvedValue(undefined)
  useAppStore.setState({ ...useAppStore.getInitialState(), document: { node: { id: 'chapter', kind: 'chapter', parentId: null, title: 'Test', orderIndex: 0, status: 'draft', filePath: 'test.md', createdAt: '', updatedAt: '' }, content: 'keep these edits' }, saveState: 'idle' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('waits for saving before destroying the window and ignores duplicate close events', async () => {
  let finish!: (ok: boolean) => void
  const save = vi.fn(() => new Promise<boolean>(r => { finish = r })); useAppStore.setState({ saveCurrentDocument: save })
  render(<WindowCloseGuard />)
  await act(async () => { mocks.listener?.(); mocks.listener?.() })
  expect(save).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled()
  await act(async () => { useAppStore.setState({saveState:'saved'}); finish(true) })
  expect(mocks.invoke).toHaveBeenCalledWith('confirm_window_close')
})
it('keeps failed content visible and permits retrying after the save failure is fixed', async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(async()=>{useAppStore.setState({saveState:'saved'});return true}); useAppStore.setState({ saveCurrentDocument: save, error: 'disk error' })
  render(<WindowCloseGuard />); await act(async () => { mocks.listener?.() })
  expect(screen.getByRole('dialog').textContent).toContain('已阻止退出')
  expect((screen.getByLabelText('未保存正文') as HTMLTextAreaElement).value).toBe('keep these edits')
  expect(mocks.invoke).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByText('重试保存并退出')) })
  expect(mocks.invoke).toHaveBeenCalledOnce()
})
it('requires an explicit confirmation to discard failed edits', async () => {
  useAppStore.setState({ saveCurrentDocument: vi.fn().mockResolvedValue(false) })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  render(<WindowCloseGuard />); await act(async () => { mocks.listener?.() })
  await act(async () => { fireEvent.click(screen.getByText('放弃修改并退出')) }); expect(mocks.invoke).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByText('放弃修改并退出')) }); expect(confirm).toHaveBeenCalledTimes(2); expect(mocks.invoke).toHaveBeenCalledOnce()
})

it('rejects closing if a successful save callback leaves newer unsaved input', async()=>{
 useAppStore.setState({saveCurrentDocument:vi.fn().mockResolvedValue(true)})
 render(<WindowCloseGuard />);await act(async()=>{mocks.listener?.()})
 expect(mocks.invoke).not.toHaveBeenCalled()
 expect(screen.getByRole('dialog').textContent).toContain('已阻止退出')
})

it('leaves the draft confirmation unobstructed before showing the closing overlay', async()=>{
 const unregister=registerDraft({id:'closing-form',label:'人物草稿',dirty:true,save:async()=>true,discard:()=>{}})
 try {
  render(<WindowCloseGuard />)
  await act(async()=>{mocks.listener?.()})
  expect(useDraftGuard.getState().open).toBe(true)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(mocks.invoke).not.toHaveBeenCalled()
  await act(async()=>{await decideDraftNavigation('cancel')})
  expect(mocks.invoke).not.toHaveBeenCalled()
 } finally {unregister()}
})
