import { beforeEach, expect, it, vi } from 'vitest'
import { ChangeSet } from '@codemirror/state'
const mocks = vi.hoisted(() => ({ generate: vi.fn(), cancel: vi.fn(), aiComplete: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: { aiComplete: mocks.aiComplete } }))
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
  useAiTask.getState().accept()
  expect(useAppStore.getState().document?.content).toBe('新增。前文。风很暖。灯很亮。后文。')
})
it('accepts one hunk, rejects another, and preserves an independently edited passage', async () => {
  await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => request())
  const [first, second] = useAiTask.getState().edits
  useAppStore.getState().updateContent('前文。风很凉。灯很暗。后文。')
  expect(useAiTask.getState().edits[0].conflict).toBe(true)
  useAiTask.getState().accept(first.id)
  expect(useAppStore.getState().document?.content).toContain('风很凉')
  useAiTask.getState().reject(first.id)
  useAiTask.getState().accept(second.id)
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
  useAiTask.getState().accept()
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
  useAiTask.getState().accept(); expect(useAppStore.getState().document?.content).toBe('另一章')
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
  useAiTask.getState().insert('target'); useAiTask.getState().insert('target')
  expect(writer).toHaveBeenCalledTimes(1)
  expect(useAppStore.getState().document?.content).toBe('前文。插入风很冷。灯很暗。后文。')
  unregister()
})
