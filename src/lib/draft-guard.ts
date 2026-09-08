import { create } from 'zustand'

type Draft = { id: string; label: string; dirty: boolean; save: () => Promise<boolean>; discard: () => void }
const drafts = new Map<string, Draft>()
let resolver: ((allowed: boolean) => void) | null = null
let pending: Promise<boolean> | null = null
let saving = false
export const useDraftGuard = create<{ revision: number; open: boolean; busy: boolean; error: string | null }>(() => ({ revision: 0, open: false, busy: false, error: null }))
const changed = () => useDraftGuard.setState(state => ({ revision: state.revision + 1 }))
export function registerDraft(draft: Draft) { drafts.set(draft.id, draft); changed(); return () => { if (drafts.get(draft.id) === draft) { drafts.delete(draft.id); changed() } } }
export const dirtyDrafts = () => [...drafts.values()].filter(draft => draft.dirty)
export function markDraftSaved(id: string) { const draft = drafts.get(id); if (draft) { draft.dirty = false; changed() } }
export function confirmDraftNavigation(): Promise<boolean> {
  if (saving || !dirtyDrafts().length) return Promise.resolve(true)
  if (pending) return Promise.resolve(false)
  pending = new Promise(resolve => { resolver = resolve })
  useDraftGuard.setState({ open: true, error: null })
  return pending
}
export function runGuarded(action: () => void) {
  if (saving || !dirtyDrafts().length) { action(); return }
  void confirmDraftNavigation().then(allowed => { if (allowed) action() })
}
function finish(allowed: boolean) { resolver?.(allowed); resolver = null; pending = null; useDraftGuard.setState({ open: false, busy: false, error: null }) }
export async function saveActiveDrafts() {
  if (saving) return false
  saving = true; useDraftGuard.setState({ busy: true, error: null })
  try {
    for (const draft of dirtyDrafts()) {
      if (!await draft.save()) { useDraftGuard.setState({ error: `${draft.label}未保存，请检查表单中的必填内容或错误提示。` }); return false }
      markDraftSaved(draft.id)
    }
    return true
  } catch (error) { useDraftGuard.setState({ error: error instanceof Error ? error.message : String(error) }); return false }
  finally { saving = false; useDraftGuard.setState({ busy: false }) }
}
export async function decideDraftNavigation(choice: 'save' | 'discard' | 'cancel') {
  if (useDraftGuard.getState().busy) return
  if (choice === 'cancel') { finish(false); return }
  if (choice === 'save') { if (await saveActiveDrafts()) finish(true); return }
  for (const draft of dirtyDrafts()) { draft.discard(); markDraftSaved(draft.id) }
  finish(true)
}
export async function saveWorkspace(reason: string) {
  const { useAppStore } = await import('../stores/app-store')
  if (dirtyDrafts().length) {
    const saved = await saveActiveDrafts()
    if (!saved) useAppStore.getState().setError(useDraftGuard.getState().error ?? '表单未保存')
    return saved
  }
  return useAppStore.getState().saveCurrentDocument(reason)
}
