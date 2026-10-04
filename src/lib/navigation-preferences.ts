import type { ViewId } from './types'
export const PINNED_NAVIGATION_KEY = 'novelforge:pinned-navigation:v1'
const allowed: ViewId[] = ['manuscript-import', 'location', 'world', 'timeline', 'foreshadowing', 'story-arc', 'inbox', 'relationship', 'attachment', 'chapter-memory', 'annotation', 'consistency', 'statistics']
export function readPinnedNavigation(): ViewId[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PINNED_NAVIGATION_KEY) ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is ViewId => typeof id === 'string' && allowed.includes(id as ViewId)))].slice(0, 4) : []
  } catch { return [] }
}
export function writePinnedNavigation(ids: ViewId[]) {
  try { localStorage.setItem(PINNED_NAVIGATION_KEY, JSON.stringify(ids.filter(id => allowed.includes(id)).slice(0, 4))) } catch { /* Optional local navigation preference. */ }
}
