import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { projectApi } from '../src/lib/api'
import { startDraftSnapshots, snapshotApi } from '../src/lib/draft-snapshots'
import { useAppStore } from '../src/stores/app-store'
import fixture from './fixtures/reliability-contract.json'
it('the real App/store snapshot subscription protects uninterrupted typing while 900ms save stays pending', async () => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  await useAppStore.getState().createProject({ ...fixture.project, path: 'runtime-snapshots-' + crypto.randomUUID() })
  const path = useAppStore.getState().projectPath!
  const save = vi.spyOn(projectApi, 'saveDocument')
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.useFakeTimers()
  const stop = startDraftSnapshots()
  const view = render(<App />)
  try {
    for (let i = 0; i < 21; i++) {
      await act(async () => { useAppStore.getState().updateContent('连续输入' + i) })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    }
    expect(save).not.toHaveBeenCalled()
    const snapshot = (await snapshotApi.list()).find(item => item.projectPath === path && item.targetId.startsWith('document:'))
    expect(snapshot?.payload).toEqual({ content: '连续输入19' })
    expect(useAppStore.getState().document?.content).toBe('连续输入20')
  } finally { view.unmount(); stop(); vi.useRealTimers(); vi.unstubAllGlobals(); save.mockRestore() }
})
