import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectData, SearchResult } from '../src/lib/types'

const api = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: false, projectApi: api }))

import { useAppStore } from '../src/stores/app-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const project: ProjectData = {
  project: {
    formatVersion: 1, id: 'project-a', title: '测试', author: '', description: '', genre: '',
    targetWords: 1000, createdAt: '', updatedAt: '',
  },
  nodes: [], entities: [], recovery: [],
}
const results = (id: string): SearchResult[] => [{ id, kind: 'chapter', title: id, path: `${id}.md`, snippet: id }]

beforeEach(() => {
  vi.resetAllMocks()
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: 'project-a', data: project })
})

describe('search request races', () => {
  it.each([
    { name: 'different queries', first: '林月', latest: '苏晴', firstOptions: {}, latestOptions: {} },
    { name: 'same query with different options', first: '林月', latest: '林月', firstOptions: { caseSensitive: false }, latestOptions: { caseSensitive: true } },
  ])('keeps only the latest results for $name', async ({ first, latest, firstOptions, latestOptions }) => {
    const old = deferred<SearchResult[]>()
    const current = deferred<SearchResult[]>()
    api.search.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    useAppStore.setState({ searchResults: results('previous') })
    const oldRun = useAppStore.getState().runSearch(first, firstOptions)
    expect(useAppStore.getState().searchResults).toEqual([])
    const latestRun = useAppStore.getState().runSearch(latest, latestOptions)
    expect(api.search.mock.calls).toEqual([
      [{ projectPath: 'project-a', query: first, ...firstOptions }],
      [{ projectPath: 'project-a', query: latest, ...latestOptions }],
    ])
    current.resolve(results('latest'))
    await latestRun
    expect(useAppStore.getState().searchResults).toEqual(results('latest'))
    old.resolve(results('stale'))
    await oldRun
    expect(useAppStore.getState().searchQuery).toBe(latest)
    expect(useAppStore.getState().searchResults).toEqual(results('latest'))
  })

  it.each(['', '   '])('invalidates pending responses when cleared to %j', async (query) => {
    const old = deferred<SearchResult[]>()
    api.search.mockReturnValueOnce(old.promise)
    const pending = useAppStore.getState().runSearch('林月')
    await useAppStore.getState().runSearch(query)
    old.resolve(results('stale'))
    await pending
    expect(api.search).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().searchQuery).toBe(query)
    expect(useAppStore.getState().searchResults).toEqual([])
  })

  it.each(['path', 'identity', 'close'] as const)('invalidates a response after project %s changes without another search', async (change) => {
    const old = deferred<SearchResult[]>()
    api.search.mockReturnValueOnce(old.promise)
    const pending = useAppStore.getState().runSearch('林月')
    // Keep the query unchanged to exercise project validation independently of the generation guard.
    if (change === 'path') useAppStore.setState({ projectPath: 'project-b' })
    if (change === 'identity') useAppStore.setState({ data: { ...project, project: { ...project.project, id: 'project-b' } } })
    if (change === 'close') useAppStore.setState({ projectPath: null, data: null })
    old.resolve(results('stale'))
    await pending
    expect(useAppStore.getState().searchResults).toEqual([])
  })

  it('rejects the first response in a query A/B/A sequence', async () => {
    const first = deferred<SearchResult[]>()
    const middle = deferred<SearchResult[]>()
    api.search.mockReturnValueOnce(first.promise).mockReturnValueOnce(middle.promise).mockResolvedValueOnce(results('latest-a'))
    const a = useAppStore.getState().runSearch('A')
    const b = useAppStore.getState().runSearch('B')
    await useAppStore.getState().runSearch('A')
    first.resolve(results('old-a'))
    middle.resolve(results('old-b'))
    await Promise.all([a, b])
    expect(useAppStore.getState().searchResults).toEqual(results('latest-a'))
  })

  it.each(['new search', 'clear', 'project switch'])('ignores stale failures after %s', async (change) => {
    const old = deferred<SearchResult[]>()
    api.search.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('当前搜索失败'))
    const pending = useAppStore.getState().runSearch('林月')
    if (change === 'new search') await useAppStore.getState().runSearch('苏晴')
    if (change === 'clear') await useAppStore.getState().runSearch('')
    if (change === 'project switch') useAppStore.setState({ projectPath: 'project-b' })
    const currentError = useAppStore.getState().error
    if (change === 'new search') expect(currentError).toContain('当前搜索失败')
    else expect(currentError).toBeNull()
    old.reject(new Error('过期搜索失败'))
    await pending
    expect(useAppStore.getState().error).toBe(currentError)
    expect(useAppStore.getState().searchResults).toEqual([])
  })
})
