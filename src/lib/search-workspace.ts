import { create } from 'zustand'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import type { ProjectSession } from '../stores/app-store'
import { runGuarded } from './draft-guard'

type SearchScope = 'project' | 'current'

interface SearchFilters {
  query: string
  kind: string
  scope: SearchScope
  nodeId: string | null
  volumePath: string
  tag: string
  caseSensitive: boolean
}

export const defaultSearchFilters: SearchFilters = {
  query: '', kind: 'all', scope: 'project', nodeId: null, volumePath: '', tag: '', caseSensitive: false,
}

interface SearchWorkspace {
  session: ProjectSession
  filters: SearchFilters
  scrollTop: number
  openedNodeId?: string
}

export const useSearchWorkspace = create<{ value: SearchWorkspace | null }>(() => ({ value: null }))

function currentWorkspace(value: SearchWorkspace | null) {
  return value && isCurrentProjectSession(value.session) ? value : null
}

export function updateSearchFilters(patch: Partial<SearchFilters>) {
  const session = captureProjectSession()
  if (!session.path) return
  useSearchWorkspace.setState(({ value }) => ({
    value: { session, filters: { ...(currentWorkspace(value)?.filters ?? defaultSearchFilters), ...patch }, scrollTop: 0 },
  }))
}

export function searchScrollPosition() {
  return currentWorkspace(useSearchWorkspace.getState().value)?.scrollTop ?? 0
}

export function rememberSearchScroll(scrollTop: number) {
  useSearchWorkspace.setState(state => {
    const workspace = currentWorkspace(state.value)
    return workspace && workspace.scrollTop !== scrollTop ? { value: { ...workspace, scrollTop } } : state
  })
}

export function rememberSearchResult(nodeId: string) {
  useSearchWorkspace.setState(state => {
    const workspace = currentWorkspace(state.value)
    return workspace ? { value: { ...workspace, openedNodeId: nodeId } } : state
  })
}

export function openScopedSearch(scope: SearchScope, query?: string) {
  const session = captureProjectSession()
  runGuarded(() => {
    if (!isCurrentProjectSession(session)) return
    const state = useAppStore.getState()
    const nodeId = scope === 'current' ? state.document?.node.id ?? null : null
    updateSearchFilters({
      ...defaultSearchFilters,
      scope: nodeId ? 'current' : 'project',
      nodeId,
      query: query?.trim() ?? currentWorkspace(useSearchWorkspace.getState().value)?.filters.query ?? '',
    })
    state.setView('search')
  })
}
