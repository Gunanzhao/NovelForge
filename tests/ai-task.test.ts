import { beforeEach, expect, it, vi } from 'vitest'
import { ChangeSet } from '@codemirror/state'
const mocks = vi.hoisted(() => ({ createHistorySnapshot: vi.fn(async () => {}), generate: vi.fn(), cancel: vi.fn(), aiCancel: vi.fn(async () => {}), aiComplete: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: { createHistorySnapshot: mocks.createHistorySnapshot, aiComplete: mocks.aiComplete, aiCancel: mocks.aiCancel } }))
vi.mock('../src/lib/codex', () => ({ codexApi: mocks }))
import { useAiTask, captureAiTarget, registerAiEditor, type AiRequest } from '../src/stores/ai-task'
import { useAppStore } from '../src/stores/app-store'
import type { NodeRecord } from '../src/lib/types'
const node = { id: 'chapter', title: '测试', kind: 'chapter', status: 'draft' } as NodeRecord
const request = (content = '风很暖。灯很亮。'): AiRequest => ({ preferences: { mode: 'offline', endpoint: '', model: '' }, apiKey: '', systemPrompt: '写作', prompt: '修改', local: { content, model: 'local' } })
beforeEach(() => {
  useAiTask.setState(useAiTask.getInitialState(), true)
  useAppStore.setState({ projectPath: 'project', projectSession: 1, data: null, document: { node, content: '前文。风很冷。灯很暗。后文。' }, editorSelection: { nodeId: 'chapter', from: 3, to: 11, text: '风很冷。灯很暗。' }, error: null })
  vi.clearAllMocks(); mocks.cancel.mockResolvedValue(undefined)
})
it('applies to the captured selection after cursor movement and unrelated edits', async () => {
  await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => request())
  useAppStore.getState().setEditorSelection({ nodeId: 'chapter', from: 0, to: 0, text: '' })
  useAppStore.getState().updateContent('新增。' + useAppStore.getState().document!.content)
  await useAiTask.getState().accept()
  expect(useAppStore.getState().document?.content).toBe('新增。前文。风很暖。灯很亮。后文。')
})
it('accepts one hunk, rejects another, and preserves an independently edited passage', async () => {
  await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => request())
  const [first, second] = useAiTask.getState().edits
  useAppStore.getState().updateContent('前文。风很凉。灯很暗。后文。')
  expect(useAiTask.getState().edits[0].conflict).toBe(true)
  await useAiTask.getState().accept(first.id)
  expect(useAppStore.getState().document?.content).toContain('风很凉')
  useAiTask.getState().reject(first.id)
  await useAiTask.getState().accept(second.id)
  expect(useAppStore.getState().document?.content).toBe('前文。风很凉。灯很亮。后文。')
})
it('maps exact disjoint editor changes during streaming and does not conflict with the middle target', async () => {
  let finish!: (value: { content: string; model: string }) => void
  mocks.generate.mockImplementation((_input, delta) => { delta('风'); return new Promise(resolve => { finish = resolve }) })
  const running = useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => ({ ...request(), preferences: { mode: 'codex', endpoint: '', model: '' } }))
  await Promise.resolve()
  const before = useAppStore.getState().document!.content
  const after = '开场。' + before + '结尾。'
  useAiTask.getState().observe(before, after, ChangeSet.of([{ from: 0, insert: '开场。' }, { from: before.length, insert: '结尾。' }], before.length))
  useAppStore.getState().updateContent(after)
  finish({ content: '风很暖。灯很亮。', model: 'writer' }); await running
  await useAiTask.getState().accept()
  expect(useAppStore.getState().document?.content).toBe('开场。前文。风很暖。灯很亮。后文。结尾。')
})
it('keeps one shared request across view changes, and discards late output after cancellation', async () => {
  let finish!: (value: { content: string; model: string }) => void
  mocks.generate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const target = captureAiTarget('cursor')
  const run = useAiTask.getState().start(target, 'generate', async () => ({ ...request(), preferences: { mode: 'codex', endpoint: '', model: '' } }))
  await Promise.resolve()
  useAppStore.setState({ activeView: 'ai' })
  await useAiTask.getState().start(target, 'generate', async () => request())
  expect(mocks.generate).toHaveBeenCalledTimes(1)
  useAiTask.getState().stop(); finish({ content: '迟到文本', model: 'writer' }); await run
  expect(useAiTask.getState().phase).toBe('cancelled')
  expect(useAiTask.getState().result?.content).not.toContain('迟到')
})
it('cancels chapter switches, clears project switches, and never writes to the wrong chapter', async () => {
  let finish!: (value: { content: string; model: string }) => void
  mocks.aiComplete.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const run = useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => ({ ...request(), preferences: { mode: 'provider', endpoint: 'https://example.invalid', model: 'writer' } }))
  await Promise.resolve()
  useAppStore.setState({ document: { node: { ...node, id: 'other' }, content: '另一章' } })
  finish({ content: '旧结果', model: 'writer' }); await run
  await useAiTask.getState().accept(); expect(useAppStore.getState().document?.content).toBe('另一章')
  useAppStore.setState({ projectSession: 2 }); expect(useAiTask.getState().target).toBeNull()
})
it('uses a registered editor transaction and inserts at the original cursor only once', async () => {
  const target = captureAiTarget('cursor')
  const writer = vi.fn((source: string, changes: ChangeSet) => {
    let next = source
    changes.iterChanges((from, to, _a, _b, inserted) => { next = next.slice(0, from) + inserted.toString() + next.slice(to) })
    useAppStore.getState().updateContent(next); return true
  })
  const unregister = registerAiEditor(target, writer)
  await useAiTask.getState().start(target, 'generate', async () => request('插入'))
  useAppStore.getState().setEditorSelection({ nodeId: node.id, from: 0, to: 0, text: '' })
  await useAiTask.getState().insert('target'); await useAiTask.getState().insert('target')
  expect(writer).toHaveBeenCalledTimes(1)
  expect(useAppStore.getState().document?.content).toBe('前文。插入风很冷。灯很暗。后文。')
  unregister()
})

it('preserves partial text for inspection but blocks every manuscript application path', async () => {
  mocks.aiComplete.mockResolvedValue({ content: '被截断的半段正文', model: 'writer', incomplete: true })
  const original = useAppStore.getState().document!.content
  await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => ({ ...request(), preferences: { mode: 'provider', endpoint: 'http://127.0.0.1:1234/v1', model: 'writer' } }))
  expect(useAiTask.getState().phase).toBe('incomplete')
  expect(useAiTask.getState().result?.content).toBe('被截断的半段正文')
  expect(useAiTask.getState().edits).toEqual([])
  await useAiTask.getState().accept(); await useAiTask.getState().replace(); await useAiTask.getState().insert('after')
  useAiTask.getState().editResult('手工改写也不能绕过完整性检查')
  expect(useAppStore.getState().document?.content).toBe(original)
  expect(useAiTask.getState().result?.content).toBe('被截断的半段正文')
})

it('cancels the provider request by the exact generation id', async () => {
  let finish!: (value: {content: string; model: string}) => void
  mocks.aiComplete.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const running = useAiTask.getState().start(captureAiTarget('chapter'), 'generate', async () => ({ ...request(), preferences: {mode:'provider',endpoint:'http://127.0.0.1:1234/v1',model:'writer'} }))
  await Promise.resolve()
  const id = useAiTask.getState().id
  expect(mocks.aiComplete.mock.calls[0][1]).toBe(id)
  useAiTask.getState().stop()
  expect(mocks.aiCancel).toHaveBeenCalledWith(id)
  finish({content:'迟到结果',model:'writer'});await running
  expect(useAiTask.getState().result).toBeNull()
})

it('persists one protection snapshot for multiple accepted hunks of the same AI result', async () => {
  const original = useAppStore.getState().document!.content
  await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => request())
  const [first, second] = useAiTask.getState().edits
  await useAiTask.getState().accept(first.id)
  await useAiTask.getState().accept(second.id)
  expect(mocks.createHistorySnapshot).toHaveBeenCalledTimes(1)
  expect(mocks.createHistorySnapshot).toHaveBeenCalledWith(expect.objectContaining({ kind: 'protected', content: original }))
  expect(useAppStore.getState().document?.content).toBe('前文。风很暖。灯很亮。后文。')
})
it('does not apply AI changes if writing the protection snapshot fails', async () => {
  const original = useAppStore.getState().document!.content
  mocks.createHistorySnapshot.mockRejectedValueOnce(new Error('快照磁盘不可写'))
  await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => request())
  await useAiTask.getState().accept()
  expect(useAppStore.getState().document?.content).toBe(original)
  expect(useAiTask.getState().error).toContain('快照磁盘不可写')
})
it('does not apply an AI edit to a chapter changed while its snapshot was pending', async () => {
  let finish!: () => void
  mocks.createHistorySnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => request())
  const applying = useAiTask.getState().accept()
  useAppStore.getState().updateContent('用户在等待期间修改正文')
  finish(); await applying
  expect(useAppStore.getState().document?.content).toBe('用户在等待期间修改正文')
})
