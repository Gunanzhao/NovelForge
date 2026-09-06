import { beforeEach, expect, it, vi } from 'vitest'
import type { DocumentData, NodeRecord, ProjectData } from '../src/lib/types'

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), saveDocument: vi.fn(), open: vi.fn(), create: vi.fn(), stats: vi.fn(),
  createNode: vi.fn(), renameNode: vi.fn(), setNodeStatus: vi.fn(), reorderNode: vi.fn(), moveNode: vi.fn(), copyNode: vi.fn(), deleteNode: vi.fn(),
  upsertEntity: vi.fn(), deleteEntity: vi.fn(), listTrash: vi.fn(), restoreTrash: vi.fn(), permanentDelete: vi.fn(), emptyTrash: vi.fn(), updateProject: vi.fn(), exportProject: vi.fn(),
}))
vi.mock('../src/lib/api', () => ({ isDesktop: false, projectApi: api }))
import { useAppStore } from '../src/stores/app-store'

const a: NodeRecord = { id: 'a', kind: 'chapter', parentId: 'v', title: 'A', orderIndex: 0, status: 'draft', filePath: 'a.md', createdAt: '', updatedAt: '' }
const b: NodeRecord = { ...a, id: 'b', title: 'B', orderIndex: 1, filePath: 'b.md' }
const c: NodeRecord = { ...a, id: 'c', title: 'C', orderIndex: 2, filePath: 'c.md' }
const project: ProjectData = { project: { formatVersion: 1, id: 'p', title: 'P', author: '', description: '', genre: '', targetWords: 1, createdAt: '', updatedAt: '' }, nodes: [a, b, c], entities: [], recovery: [] }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { resolve, reject, promise } }
beforeEach(() => {
  vi.resetAllMocks()
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: 'P', data: project, document: { node: a, content: 'original' }, saveState: 'saved' })
  api.stats.mockResolvedValue(useAppStore.getState().stats)
  api.getDocument.mockImplementation(async ({ nodeId }: { nodeId: string }) => ({ node: project.nodes.find(n => n.id === nodeId), content: nodeId }))
  api.saveDocument.mockImplementation(async ({ content }: { content: string }) => ({ node: a, content }))
})

it('keeps the latest chapter request when reads complete out of order', async () => {
  const slow = deferred<DocumentData>()
  api.getDocument.mockReturnValueOnce(slow.promise)
  const first = useAppStore.getState().selectNode('b')
  await useAppStore.getState().selectNode('c')
  slow.resolve({ node: b, content: 'old B' }); await first
  expect(useAppStore.getState().document?.node.id).toBe('c')
})
it('preserves editing while a chapter read is pending', async () => {
  const slow = deferred<DocumentData>(); api.getDocument.mockReturnValueOnce(slow.promise)
  const first = useAppStore.getState().selectNode('b')
  useAppStore.getState().updateContent('new edits')
  slow.resolve({ node: b, content: 'B' }); await first
  expect(useAppStore.getState().document?.content).toBe('new edits')
  expect(useAppStore.getState().saveState).toBe('idle')
})
it('reselecting the current chapter invalidates a pending read without overwriting edits', async () => {
  const slow = deferred<DocumentData>(); api.getDocument.mockReturnValueOnce(slow.promise)
  const first = useAppStore.getState().selectNode('b'); await useAppStore.getState().selectNode('a')
  useAppStore.getState().updateContent('new edits'); slow.resolve({ node: b, content: 'B' }); await first
  expect(useAppStore.getState().document?.content).toBe('new edits')
})

const mutations = [
  ['createNode', () => useAppStore.getState().createNode('chapter', 'new', 'v')],
  ['renameNode', () => useAppStore.getState().renameNode('a', 'renamed')],
  ['setNodeStatus', () => useAppStore.getState().setNodeStatus('a', 'done')],
  ['reorderNode', () => useAppStore.getState().reorderNode('a', 'down')],
  ['moveNode', () => useAppStore.getState().moveNode('a', 'other-volume')],
  ['copyNode', () => useAppStore.getState().copyNode('a', 'v')],
  ['deleteNode', () => useAppStore.getState().deleteNode('a')],
  ['upsertEntity', () => useAppStore.getState().saveEntity({ projectPath: 'P', id: null, kind: 'character', title: 'Alice', tags: [], content: {} })],
  ['deleteEntity', () => useAppStore.getState().deleteEntity('alice')],
  ['restoreTrash', () => useAppStore.getState().restoreTrash('trash')],
  ['permanentDelete', () => useAppStore.getState().permanentlyDelete('trash')],
  ['emptyTrash', () => useAppStore.getState().emptyTrash()],
  ['updateProject', () => useAppStore.getState().updateProject({ title: 'new', author: '', description: '', genre: '', targetWords: 1 })],
] as const
it.each(mutations)('rejects stale %s responses even after reopening the same project', async (method, run) => {
  const slow = deferred<ProjectData>(); api[method].mockReturnValueOnce(slow.promise)
  const pending = run()
  await useAppStore.getState().closeProject()
  const next = { ...project, project: { ...project.project, title: 'reopened' } }
  useAppStore.setState({ projectPath: 'P', data: next, document: { node: c, content: 'reopened text' }, saveState: 'saved' })
  slow.resolve(project); await pending
  expect(useAppStore.getState().data).toBe(next)
  expect(useAppStore.getState().document?.content).toBe('reopened text')
})
it('rejects old project data even if a caller omitted its session token', async () => {
  const next = { ...project, project: { ...project.project, id: 'q' } }
  useAppStore.setState({ projectPath: 'Q', data: next })
  await useAppStore.getState().refreshData(project)
  expect(useAppStore.getState().data).toBe(next)
})
it('does not resurrect a project after it was closed during opening', async () => {
  const slow = deferred<ProjectData>(); api.open.mockReturnValueOnce(slow.promise)
  const pending = useAppStore.getState().openProject('other')
  await useAppStore.getState().closeProject(); slow.resolve(project); await pending
  expect(useAppStore.getState().projectPath).toBeNull()
})
it('saves input entered during a project open before switching', async () => {
  const slow = deferred<ProjectData>(); api.open.mockReturnValueOnce(slow.promise)
  const pending = useAppStore.getState().openProject('other')
  useAppStore.getState().updateContent('typed during open')
  slow.resolve({ ...project, project: { ...project.project, id: 'other' } }); await pending
  expect(api.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ projectPath: 'P', content: 'typed during open' }))
  expect(useAppStore.getState().projectPath).toBe('other')
})
it('waits for dirty content to save before exporting', async () => {
  const pending = deferred<DocumentData>(); api.saveDocument.mockReturnValueOnce(pending.promise)
  api.exportProject.mockResolvedValue('out.md'); useAppStore.getState().updateContent('new')
  const exporting = useAppStore.getState().exportProject('markdown')
  expect(api.exportProject).not.toHaveBeenCalled()
  pending.resolve({ node: a, content: 'new' }); await exporting
  expect(api.exportProject).toHaveBeenCalledOnce()
})
it('does not export after a failed save', async () => {
  api.saveDocument.mockRejectedValue(new Error('disk error')); useAppStore.getState().updateContent('new')
  await expect(useAppStore.getState().exportProject('markdown')).rejects.toThrow('已取消导出')
  expect(api.exportProject).not.toHaveBeenCalled()
})
