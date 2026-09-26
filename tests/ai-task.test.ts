import { editorChangesFromSource, normalizeLineBreaks } from '../src/lib/newline-offsets'
import type { AiAcceptance } from '../src/lib/ai-edit'
import { beforeEach, expect, it, vi } from 'vitest'
import { ChangeSet, EditorState } from '@codemirror/state'
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

it('captures the exact original CRLF passage from editor LF selection coordinates', () => {
  const content = '# 章节\r\n前文。\r\n风很冷。\r\n灯很暗。\r\n后文。'
  const normalized = content.replace(/\r\n/gu, '\n')
  const from = normalized.indexOf('风'), to = normalized.indexOf('后文')
  useAppStore.setState({ document: { node, content }, editorSelection: { nodeId: node.id, from, to, text: normalized.slice(from, to) } })
  const target = captureAiTarget('selection')
  expect(target.originalText).toBe('风很冷。\r\n灯很暗。\r\n')
  expect(target.from).toBe(content.indexOf('风'))
  expect(captureAiTarget('cursor').from).toBe(content.indexOf('风'))
  expect(captureAiTarget('selection', { from: target.from, to: target.to }).originalText).toBe(target.originalText)
})
it('refuses an obsolete editor selection rather than sending unrelated source text', () => {
  useAppStore.setState({ editorSelection: { nodeId: node.id, from: 3, to: 11, text: '已经过期的选区' } })
  expect(() => captureAiTarget('selection')).toThrow('选区正文已变化')
})

it('applies separate CRLF suggestions through editor transactions and permits undo and reaccept', async () => {
  const content = '# 标题\r\n风很冷。\r\n灯很暗。\r\n后文。'
  const plain = normalizeLineBreaks(content), from = plain.indexOf('风'), to = plain.indexOf('后文')
  useAppStore.setState({ document: { node, content }, editorSelection: { nodeId: node.id, from, to, text: plain.slice(from, to) } })
  let editor = EditorState.create({ doc: plain })
  const inverses: Array<{ changes: ChangeSet; acceptance?: AiAcceptance }> = []
  const unregister = registerAiEditor(captureAiTarget('selection'), (source, changes, acceptance) => {
    if (editor.doc.toString() !== normalizeLineBreaks(source)) return false
    const mapped = editorChangesFromSource(source, changes), before = editor.doc.toString()
    inverses.push({ changes: mapped.invert(editor.doc), acceptance })
    editor = editor.update({ changes: mapped }).state
    useAiTask.getState().observe(before, editor.doc.toString(), mapped, acceptance)
    useAppStore.getState().updateContent(editor.doc.toString())
    return true
  })
  try {
    await useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => request('风很暖。\r\n灯很亮。\r\n'))
    const ids = useAiTask.getState().edits.map(edit => edit.id)
    for (const id of ids) { await useAiTask.getState().accept(id); expect(useAiTask.getState().error, JSON.stringify({ id, source: useAiTask.getState().source, edits: useAiTask.getState().edits })).toBe('') }
    expect(editor.doc.toString()).toBe('# 标题\n风很暖。\n灯很亮。\n后文。')
    expect(mocks.createHistorySnapshot).toHaveBeenCalledWith(expect.objectContaining({ content }))
    const inverse = inverses.at(-1)!, before = editor.doc.toString()
    editor = editor.update({ changes: inverse.changes }).state
    useAiTask.getState().observe(before, editor.doc.toString(), inverse.changes, { ...inverse.acceptance!, accepted: false })
    useAppStore.getState().updateContent(editor.doc.toString())
    const pending = useAiTask.getState().edits.filter(edit => edit.state === 'pending')
    expect(pending.length).toBeGreaterThan(0)
    await useAiTask.getState().accept(pending[0].id)
    expect(useAiTask.getState().error).toBe('')
    expect(editor.doc.toString()).toBe('# 标题\n风很暖。\n灯很亮。\n后文。')
  } finally { unregister() }
})

it('reediting an AI result preserves nonconflicting hunks after CRLF normalization', async () => {
  const content='# 标题\r\n风很冷。\r\n灯很暗。\r\n后文。',plain=normalizeLineBreaks(content)
  const from=plain.indexOf('风'),to=plain.indexOf('后文')
  useAppStore.setState({document:{node,content},editorSelection:{nodeId:node.id,from,to,text:plain.slice(from,to)}})
  await useAiTask.getState().start(captureAiTarget('selection'),'rewrite',async()=>request('风很暖。\n灯很亮。\n'))
  const editor=EditorState.create({doc:plain}),pos=plain.indexOf('冷')
  const changes=ChangeSet.of({from:pos,to:pos+1,insert:'凉'},plain.length)
  const after=editor.update({changes}).state.doc.toString()
  useAiTask.getState().observe(plain,after,changes)
  useAppStore.getState().updateContent(after)
  useAiTask.getState().editResult('风很暖。\n灯很明。\n')
  const lamp=useAiTask.getState().edits.find(e=>e.before==='暗')!
  expect(lamp).toBeDefined()
  expect(lamp.conflict).toBe(false)
  expect(after.slice(lamp.from,lamp.to)).toBe('暗')
  await useAiTask.getState().accept(lamp.id)
  expect(useAiTask.getState().error).toBe('')
  expect(useAppStore.getState().document?.content).toBe('# 标题\n风很凉。\n灯很明。\n后文。')
})
