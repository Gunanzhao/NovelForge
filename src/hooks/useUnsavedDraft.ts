import { useLayoutEffect, useRef } from 'react'
import { registerDraft } from '../lib/draft-guard'

export function useUnsavedDraft(id: string, label: string, dirty: boolean, save: () => Promise<boolean>, discard: () => void) {
  const latest = useRef({ save, discard })
  useLayoutEffect(() => { latest.current = { save, discard } })
  useLayoutEffect(() => registerDraft({ id, label, dirty, save: () => latest.current.save(), discard: () => latest.current.discard() }), [id, label, dirty])
}