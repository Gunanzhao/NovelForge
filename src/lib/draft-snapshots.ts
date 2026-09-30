import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { isDesktop } from './api'
import { DraftSnapshotScheduler, type DraftSnapshot } from './draft-snapshot-scheduler'
import { useAppStore } from '../stores/app-store'
export const SNAPSHOT_PERIOD_MS = 10_000
export const useSnapshotStatus = create<{ error: string | null }>(() => ({ error: null }))
const demo = new Map<string, DraftSnapshot>()
export const snapshotApi = {
  put: async (input: DraftSnapshot) => { if (isDesktop) await invoke('put_draft_snapshot', { input }); else demo.set(input.projectPath + ':' + input.targetId, input) },
  acknowledge: async (id: string) => { if (isDesktop) await invoke('acknowledge_draft_snapshot', { id }); else for (const [key, value] of demo) if (value.id === id) demo.delete(key) },
  list: async (): Promise<DraftSnapshot[]> => isDesktop ? invoke('list_draft_snapshots') : [...demo.values()],
}
export const snapshotScheduler = new DraftSnapshotScheduler(snapshotApi, error => useSnapshotStatus.setState({ error }))
export function captureFormDraft(targetId: string, label: string, payload: unknown, dirty: boolean) {
  const state = useAppStore.getState()
  if (!state.projectPath || !state.data) return
  snapshotScheduler.update(state.projectPath + ':' + targetId, { projectPath: state.projectPath, projectId: state.data.project.id, targetId, label, payload }, dirty)
}
export function startDraftSnapshots() {
  const capture = () => {
    const state = useAppStore.getState()
    if (!state.projectPath || !state.data || !state.document) return
    captureFormDraft('document:' + state.document.node.id, state.document.node.title, { content: state.document.content }, state.saveState !== 'saved')
  }
  capture()
  const unsubscribe = useAppStore.subscribe(capture)
  const timer = setInterval(() => { void snapshotScheduler.flush() }, SNAPSHOT_PERIOD_MS)
  return () => { clearInterval(timer); unsubscribe() }
}
