import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const capture = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/draft-snapshots', () => ({ captureFormDraft: capture }))
import { useUnsavedDraft } from '../src/hooks/useUnsavedDraft'
import { useAppStore } from '../src/stores/app-store'
it('never records the old form transition frame under a new project or entity', () => {
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: 'P', projectSession: 1 })
  const save = async () => true, discard = () => {}
  const hook = renderHook(({ targetId, title }) => useUnsavedDraft('guard', '资料', true, save, discard, { targetId, payload: { title } }), { initialProps: { targetId: 'entity:one', title: 'old form' } })
  expect(capture).toHaveBeenCalledWith('entity:one', '资料', { title: 'old form' }, true)
  capture.mockClear()
  act(() => useAppStore.setState({ projectPath: 'Q', projectSession: 2 }))
  expect(capture).not.toHaveBeenCalled()
  hook.rerender({ targetId: 'entity:two', title: 'old form' })
  expect(capture).not.toHaveBeenCalled()
  hook.rerender({ targetId: 'entity:two', title: 'new form' })
  expect(capture).toHaveBeenCalledOnce()
  expect(capture).toHaveBeenCalledWith('entity:two', '资料', { title: 'new form' }, true)
  hook.unmount()
})
