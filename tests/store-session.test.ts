import { beforeEach, expect, it, vi } from 'vitest'
import type { DocumentData, NodeRecord, ProjectData } from '../src/lib/types'

const api = vi.hoisted(() => ({
  release: vi.fn(async () => {}), createHistorySnapshot: vi.fn(async () => {}), getDocument: vi.fn(), saveDocument: vi.fn(), open: vi.fn(), create: vi.fn(), stats: vi.fn(),
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
it.each(['a', 'v'])('protects edits under lock %s, without blocking a clean close/save', async (id) => {
  const volume: NodeRecord = { ...a, id: 'v', parentId: null, kind: 'volume' }
  useAppStore.setState({ data: { ...project, nodes: [...project.nodes, volume].map(n => n.id === id ? { ...n, status: 'locked' } : n) } })
  useAppStore.getState().updateContent('must not change')
  expect(useAppStore.getState().document?.content).toBe('original')
  expect(useAppStore.getState().error).toContain('锁定')
  expect(await useAppStore.getState().saveCurrentDocument()).toBe(true)
  expect(api.saveDocument).not.toHaveBeenCalled()
})
it('does not lock if dirty edits cannot be saved', async () => {
  useAppStore.getState().updateContent('unsaved')
  api.saveDocument.mockRejectedValueOnce(new Error('disk failure'))
  await useAppStore.getState().setNodeStatus('a', 'locked')
  expect(api.setNodeStatus).not.toHaveBeenCalled()
  expect(useAppStore.getState().document?.content).toBe('unsaved')
})
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
  await vi.waitFor(() => expect(api.getDocument).toHaveBeenCalled())
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
  await vi.waitFor(() => expect(api.open).toHaveBeenCalled())
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

it('flushes clean body content to history before leaving, and blocks leaving if that snapshot fails', async () => {
  await useAppStore.getState().selectNode('b')
  expect(api.createHistorySnapshot).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'a', content: 'original', kind: 'checkpoint' }))
  api.createHistorySnapshot.mockRejectedValueOnce(new Error('历史保存失败'))
  expect(await useAppStore.getState().closeProject()).toBe(false)
  expect(useAppStore.getState().projectPath).toBe('P')
})
it('keeps edits made while the final checkpoint is being written', async () => {
  const slow = deferred<void>()
  api.createHistorySnapshot.mockReturnValueOnce(slow.promise)
  const closing = useAppStore.getState().closeProject()
  useAppStore.getState().updateContent('关闭前继续输入')
  slow.resolve(); expect(await closing).toBe(false)
  expect(useAppStore.getState().document?.content).toBe('关闭前继续输入')
})

it.each(['switch','close'])('keeps input that arrives while post-save statistics starts on %s', async(action) => {
 const slow=deferred<unknown>()
 api.stats.mockImplementationOnce(()=>{
   useAppStore.getState().updateContent('统计期间新输入')
   return slow.promise
 })
 useAppStore.getState().updateContent('离开前草稿')
 const result=await (action==='switch'?useAppStore.getState().selectNode('b'):useAppStore.getState().closeProject())
 expect(useAppStore.getState().document?.content).toBe('统计期间新输入')
 expect(useAppStore.getState().projectPath).toBe('P')
 if(action==='close') expect(result).toBe(false)
 slow.resolve(useAppStore.getState().stats)
})
it('does not wait for statistics before completing a body save', async()=>{
 const slow=deferred<unknown>();api.stats.mockReturnValueOnce(slow.promise)
 useAppStore.getState().updateContent('新稿')
 expect(await useAppStore.getState().saveCurrentDocument()).toBe(true)
 expect(useAppStore.getState().saveState).toBe('saved')
 slow.resolve(useAppStore.getState().stats)
})
it('keeps input during project lease release and reacquires without reloading',async()=>{
 const slow=deferred<void>();api.release.mockReturnValueOnce(slow.promise)
 const closing=useAppStore.getState().closeProject()
 await vi.waitFor(()=>expect(api.release).toHaveBeenCalled())
 useAppStore.getState().updateContent('释放期间的新内容')
 slow.resolve();expect(await closing).toBe(false)
 expect(useAppStore.getState().document?.content).toBe('释放期间的新内容')
 expect(api.getDocument).toHaveBeenCalledWith({projectPath:'P',nodeId:'a'})
})
it.each([false,true])('synchronizes renamed disk baseline without losing concurrent input (%s)',async(edit)=>{
 useAppStore.setState({document:{node:a,content:'# A\n\n原文',persistedContent:'# A\n\n原文'}})
 const slow=deferred<ProjectData & {renamedDocument:DocumentData}>();api.renameNode.mockReturnValueOnce(slow.promise)
 const renaming=useAppStore.getState().renameNode('a','新名')
 if(edit) useAppStore.getState().updateContent('# A\n\n原文追加')
 slow.resolve({...project,renamedDocument:{node:{...a,title:'新名'},content:'# 新名\n\n原文'}})
 await renaming
 expect(useAppStore.getState().document?.content).toBe(edit?'# 新名\n\n原文追加':'# 新名\n\n原文')
 expect(useAppStore.getState().document?.persistedContent).toBe('# 新名\n\n原文')
 if(edit) {
   await useAppStore.getState().saveCurrentDocument()
   expect(api.saveDocument).toHaveBeenLastCalledWith(expect.objectContaining({expectedContent:'# 新名\n\n原文',content:'# 新名\n\n原文追加'}))
 }
})

it.each(['edit','cancel','chapter','project','repeat','error'])('NF-07 rejects stale conflict reload: %s', async action => {
  useAppStore.setState({error:'EXTERNAL_CONFLICT:disk changed'})
  const slow=deferred<DocumentData>();api.getDocument.mockReturnValueOnce(slow.promise)
  const first=useAppStore.getState().reloadConflictedDocument()
  await vi.waitFor(()=>expect(api.getDocument).toHaveBeenCalled())
  if(action==='edit')useAppStore.getState().updateContent('new input')
  if(action==='cancel')useAppStore.getState().clearError()
  if(action==='chapter')useAppStore.setState({document:{node:b,content:'B new input'},documentVersion:5,saveState:'idle'})
  if(action==='project')useAppStore.setState({projectSession:99,projectPath:'Q'})
  if(action==='repeat'){api.getDocument.mockResolvedValueOnce({node:a,content:'new disk'});await useAppStore.getState().reloadConflictedDocument()}
  const before=useAppStore.getState()
  if(action==='error'){slow.reject(new Error('read failed'));await expect(first).rejects.toThrow('read failed')}
  else {slow.resolve({node:a,content:'old disk'});expect(await first).toBe(false)}
  expect(useAppStore.getState().document).toBe(before.document)
  expect(useAppStore.getState().saveState).toBe(before.saveState)
  expect(api.createHistorySnapshot).toHaveBeenCalledWith(expect.objectContaining({content:'original',kind:'protected'}))
})
it('NF-07 protects the exact current draft before accepting disk content', async()=>{
  useAppStore.setState({error:'EXTERNAL_CONFLICT:changed'})
  api.getDocument.mockResolvedValue({node:a,content:'disk'})
  expect(await useAppStore.getState().reloadConflictedDocument()).toBe(true)
  expect(useAppStore.getState().document?.persistedContent).toBe('disk')
})

it('preserves current edits and selection when deleting an unrelated chapter', async () => {
  const slow = deferred<ProjectData>(); api.deleteNode.mockReturnValueOnce(slow.promise)
  const pending = useAppStore.getState().deleteNode('b')
  useAppStore.getState().updateContent('typed during deletion')
  const version = useAppStore.getState().documentVersion
  slow.resolve({ ...project, nodes: [a, c] }); await pending
  expect(useAppStore.getState().document?.content).toBe('typed during deletion')
  expect(useAppStore.getState().documentVersion).toBe(version)
  expect(useAppStore.getState().saveState).toBe('idle')
  expect(api.getDocument).not.toHaveBeenCalled()
})
it('protects affected content and blocks edits only during deletion, then unlocks on failure', async () => {
  const slow = deferred<ProjectData>(); api.deleteNode.mockReturnValueOnce(slow.promise)
  const pending = useAppStore.getState().deleteNode('v')
  await vi.waitFor(() => expect(api.deleteNode).toHaveBeenCalled())
  expect(api.createHistorySnapshot).toHaveBeenCalledWith(expect.objectContaining({ content: 'original' }))
  useAppStore.getState().updateContent('blocked')
  expect(useAppStore.getState().document?.content).toBe('original')
  slow.reject(new Error('delete failed')); await expect(pending).rejects.toThrow('delete failed')
  useAppStore.getState().updateContent('editable again')
  expect(useAppStore.getState().document?.content).toBe('editable again')
})
it('keeps a newly selected surviving chapter after deleting the previous chapter', async () => {
  const slow = deferred<ProjectData>(); api.deleteNode.mockReturnValueOnce(slow.promise)
  const pending = useAppStore.getState().deleteNode('a')
  await vi.waitFor(() => expect(api.deleteNode).toHaveBeenCalled())
  await useAppStore.getState().selectNode('b'); useAppStore.getState().updateContent('new B')
  slow.resolve({ ...project, nodes: [b, c] }); await pending
  expect(useAppStore.getState().document?.content).toBe('new B')
})
