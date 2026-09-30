import { expect, it, vi } from 'vitest'
import { decideDraftNavigation, registerDraft, runGuarded } from '../src/lib/draft-guard'
it('drops concurrent navigation to a different destination instead of reusing the first confirmation', async () => {
  const cleanup = registerDraft({ id: 'concurrent-navigation', label: 'draft', dirty: true, save: async () => true, discard: vi.fn() })
  const first = vi.fn(), second = vi.fn()
  runGuarded(first); runGuarded(second)
  await decideDraftNavigation('discard')
  await Promise.resolve()
  expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled()
  cleanup()
})
