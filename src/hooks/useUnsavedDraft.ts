import { captureFormDraft } from '../lib/draft-snapshots'
import { useLayoutEffect, useRef } from 'react'
import { registerDraft } from '../lib/draft-guard'

export function useUnsavedDraft(id: string, label: string, dirty: boolean, save: () => Promise<boolean>, discard: () => void, snapshot?: { targetId: string; payload: unknown }) {
  useLayoutEffect(() => { if (snapshot) captureFormDraft(snapshot.targetId, label, snapshot.payload, dirty) })
  const latest = useRef({ save, discard })
  useLayoutEffect(() => { latest.current = { save, discard } })
  useLayoutEffect(() => registerDraft({ id, label, dirty, save: () => latest.current.save(), discard: () => latest.current.discard() }), [id, label, dirty])
}