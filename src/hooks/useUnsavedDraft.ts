import { captureFormDraft } from '../lib/draft-snapshots'
import { useLayoutEffect, useRef } from 'react'
import { registerDraft } from '../lib/draft-guard'
import { useAppStore } from '../stores/app-store'

export function useUnsavedDraft(id: string, label: string, dirty: boolean, save: () => Promise<boolean>, discard: () => void, snapshot?: { targetId: string; payload: unknown }) {
  const session = useAppStore(state => state.projectPath + ':' + state.projectSession)
  const identity = session + ':' + snapshot?.targetId
  const previous = useRef({ identity, payload: '', transitioning: false })
  useLayoutEffect(() => {
    if (!snapshot) return
    const payload = JSON.stringify(snapshot.payload)
    if (previous.current.identity !== identity) {
      // The parent may reset local fields in a passive effect. Do not attribute
      // that transition frame's old fields to the new project/entity.
      previous.current = { identity, payload: previous.current.payload, transitioning: true }
    }
    if (previous.current.transitioning && previous.current.payload === payload) return
    previous.current = { identity, payload, transitioning: false }
    captureFormDraft(snapshot.targetId, label, snapshot.payload, dirty)
  })
  const latest = useRef({ save, discard })
  useLayoutEffect(() => { latest.current = { save, discard } })
  useLayoutEffect(() => registerDraft({ id, label, dirty, save: () => latest.current.save(), discard: () => latest.current.discard() }), [id, label, dirty])
}
