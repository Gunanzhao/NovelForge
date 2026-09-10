import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'
import { openSearchPanel, replaceAll, SearchQuery, setSearchQuery, selectNextOccurrence } from '@codemirror/search'
const mocks = vi.hoisted(() => ({ createHistorySnapshot: vi.fn(async () => {}), aiComplete: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: { createHistorySnapshot: mocks.createHistorySnapshot, aiComplete: mocks.aiComplete } }))
import { EditorPane } from '../src/components/EditorPane'
import { AiAssistantView } from '../src/components/AiAssistantView'
import { ContextMenuProvider } from '../src/components/ContextMenu'
import { useAppStore } from '../src/stores/app-store'
import { captureAiTarget, useAiTask } from '../src/stores/ai-task'
import { writeAiPreferences } from '../src/lib/ai-data'
import type { NodeRecord, ProjectData } from '../src/lib/types'

const node = { id: 'chapter', title: '雨夜', kind: 'chapter', status: 'draft', filePath: 'chapter.md' } as NodeRecord
const content = '前文。风很冷。灯很暗。后文。'
const data = { project: { id: 'project', title: '测试' }, nodes: [node], entities: [], recovery: [] } as unknown as ProjectData
beforeEach(() => {
  useAiTask.setState(useAiTask.getInitialState(), true)
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: 'project', projectSession: 1, data, document: { node, content }, activeView: 'manuscript' })
  writeAiPreferences({ mode: 'provider', endpoint: 'https://example.invalid/v1', model: 'writer' })
  vi.clearAllMocks(); mocks.aiComplete.mockResolvedValue({ content: '风很暖。灯很亮。', model: 'writer' })
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect(100, 200, 120, 20)
})
afterEach(cleanup)
function editor() {
  return EditorView.findFromDOM(globalThis.document.querySelector('.cm-content')!)!
}
function setup() {
  return render(<ContextMenuProvider fallbackItems={[]}><EditorPane /><AiAssistantView compact /></ContextMenuProvider>)
}
it('keeps native selection editing single-target, including Ctrl+D and undo/redo', () => {
  useAppStore.setState({ document: { node, content: '海风与海风' } })
  setup()
  act(() => {
    editor().dispatch({ selection: { anchor: 0, head: 2 } })
    selectNextOccurrence(editor())
  })
  expect(editor().state.selection.ranges).toHaveLength(1)
  act(() => editor().dispatch(editor().state.replaceSelection('雨')))
  expect(editor().state.doc.toString().match(/海风/g)).toHaveLength(1)
  const changed = editor().state.doc.toString()
  act(() => { undo(editor()) })
  expect(editor().state.doc.toString()).toBe('海风与海风')
  act(() => { redo(editor()) })
  expect(editor().state.doc.toString()).toBe(changed)
})
it('opens AI in the manuscript without sending, and sends only the explicitly captured selection', async () => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  fireEvent.click(screen.getByRole('button', { name: 'AI 辅助' }))
  expect(useAppStore.getState().activeView).toBe('manuscript')
  expect(useAppStore.getState().inspectorTab).toBe('ai')
  expect(mocks.aiComplete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
  await screen.findByDisplayValue('风很暖。灯很亮。')
  expect(mocks.aiComplete.mock.calls[0][0].prompt).toContain('风很冷。灯很暗。')
  expect(mocks.aiComplete.mock.calls[0][0].prompt).not.toContain('前文。')
  expect(mocks.aiComplete.mock.calls[0][0].prompt).not.toContain('后文。')
})
it('accepts differences through one editor transaction and supports undo and redo', async () => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  fireEvent.click(screen.getByRole('button', { name: 'AI 辅助' }))
  fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
  await screen.findByDisplayValue('风很暖。灯很亮。')
  act(() => editor().dispatch({ selection: { anchor: 0 } }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '替换选区' })) })
  expect(editor().state.doc.toString()).toBe('前文。风很暖。灯很亮。后文。')
  act(() => { undo(editor()) })
  expect(editor().state.doc.toString()).toBe(content)
  expect(useAiTask.getState().edits.every(edit => edit.state === 'pending' && !edit.conflict)).toBe(true)
  act(() => { redo(editor()) })
  expect(editor().state.doc.toString()).toBe('前文。风很暖。灯很亮。后文。')
  expect(useAiTask.getState().edits.every(edit => edit.state === 'accepted')).toBe(true)
})
it('preserves unrelated editor changes and reviews each hunk separately', async () => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  fireEvent.click(screen.getByRole('button', { name: 'AI 辅助' }))
  fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
  await screen.findByDisplayValue('风很暖。灯很亮。')
  act(() => editor().dispatch({ changes: [{ from: 0, insert: '开头。' }, { from: content.length, insert: '结尾。' }] }))
  fireEvent.click(screen.getByRole('button', { name: /修改对比/ }))
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '接受此项' })[0]) })
  fireEvent.click(screen.getByRole('button', { name: '保留原文' }))
  expect(editor().state.doc.toString()).toBe('开头。前文。风很暖。灯很暗。后文。结尾。')
})
it('retains a pending request when changing workbench presentation and binds insertion to the original cursor', async () => {
  let finish!: (result: { content: string; model: string }) => void
  mocks.aiComplete.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<AiAssistantView compact />)
  act(() => useAppStore.getState().openEditorAi('continue'))
  fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
  await waitFor(() => expect(mocks.aiComplete).toHaveBeenCalledTimes(1))
  view.rerender(<AiAssistantView />)
  await act(async () => finish({ content: '续写结果', model: 'writer' }))
  expect(screen.getByDisplayValue('续写结果')).toBeTruthy()
  expect(mocks.aiComplete).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '插入原光标处' })) })
  expect(useAppStore.getState().document?.content).toBe(content + '续写结果')
})
it('selects the chapter when switching to summary after expanding an inline selection task', async () => {
  const view = render(<AiAssistantView compact />)
  act(() => {
    useAppStore.getState().setEditorSelection({ nodeId: node.id, from: 3, to: 11, text: '风很冷。灯很暗。' })
    useAppStore.getState().openEditorAi('polish')
  })
  act(() => useAppStore.setState({ activeView: 'ai' }))
  view.rerender(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '摘要' }))
  fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
  await waitFor(() => expect(mocks.aiComplete).toHaveBeenCalledTimes(1))
  expect(mocks.aiComplete.mock.calls[0][0].prompt).toContain(content)
  expect(useAiTask.getState().target?.kind).toBe('chapter')
})
it('blocks application to locked chapters even when the result was generated before locking', async () => {
  setup()
  await act(async () => useAiTask.getState().start(captureAiTarget('chapter'), 'rewrite', async () => ({ preferences: { mode: 'offline', endpoint: '', model: '' }, apiKey: '', systemPrompt: '', prompt: '润色', local: { content: '新正文', model: 'local' } })))
  act(() => useAppStore.setState({ data: { ...data, nodes: [{ ...node, status: 'locked' }] } }))
  await act(async () => useAiTask.getState().accept())
  expect(editor().state.doc.toString()).toBe(content)
  expect(useAppStore.getState().error).toContain('锁定')
})

it('keeps preview open when focus leaves the editor without changing the selection', async () => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  fireEvent.click(screen.getByRole('button', { name: 'AI 辅助' }))
  fireEvent.click(screen.getByRole('button', { name: '预览上下文' }))
  await screen.findByRole('dialog', { name: '请求预览' })
  act(() => editor().dispatch({}))
  expect(screen.getByRole('dialog', { name: '请求预览' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '返回编辑' }))
  expect(mocks.aiComplete).not.toHaveBeenCalled()
})
it.each(['风很温暖。灯很明亮。', '风冷。灯暗。', '风很冷。新句。灯很暗。'])('tracks review state through undo and redo for %s', async replacement => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  await act(async () => useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => ({ preferences: { mode: 'offline', endpoint: '', model: '' }, apiKey: '', systemPrompt: '', prompt: '测试', local: { content: replacement, model: 'local' } })))
  await act(async () => useAiTask.getState().accept())
  expect(editor().state.doc.toString()).toBe('前文。' + replacement + '后文。')
  act(() => { undo(editor()) })
  expect(editor().state.doc.toString()).toBe(content)
  expect(useAiTask.getState().edits.every(edit => edit.state === 'pending' && !edit.conflict)).toBe(true)
  await act(async () => useAiTask.getState().accept())
  expect(editor().state.doc.toString()).toBe('前文。' + replacement + '后文。')
})

it('can revise and reapply a suggestion after undo without carrying a stale conflict', async () => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  await act(async () => useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => ({ preferences: { mode: 'offline', endpoint: '', model: '' }, apiKey: '', systemPrompt: '', prompt: '测试', local: { content: '风很温暖。灯很亮。', model: 'local' } })))
  await act(async () => useAiTask.getState().accept())
  act(() => { undo(editor()) })
  act(() => useAiTask.getState().editResult('风很轻。灯很亮。'))
  expect(useAiTask.getState().edits.some(edit => edit.conflict)).toBe(false)
  await act(async () => useAiTask.getState().accept())
  expect(editor().state.doc.toString()).toBe('前文。风很轻。灯很亮。后文。')
})

it('does not mark a revised suggestion accepted when redoing an older result', async () => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  await act(async () => useAiTask.getState().start(captureAiTarget('selection'), 'rewrite', async () => ({ preferences: { mode: 'offline', endpoint: '', model: '' }, apiKey: '', systemPrompt: '', prompt: '测试', local: { content: '风很温暖。灯很亮。', model: 'local' } })))
  await act(async () => useAiTask.getState().accept())
  act(() => { undo(editor()) })
  act(() => useAiTask.getState().editResult('风很轻。灯很亮。'))
  act(() => { redo(editor()) })
  expect(editor().state.doc.toString()).toBe('前文。风很温暖。灯很亮。后文。')
  expect(useAiTask.getState().edits.every(edit => edit.state === 'pending')).toBe(true)
  expect(useAiTask.getState().edits.some(edit => edit.conflict)).toBe(true)
  await act(async () => useAiTask.getState().accept())
  expect(editor().state.doc.toString()).toBe('前文。风很温暖。灯很亮。后文。')
})

it.each(['polish', 'rewrite', 'expand', 'shrink'])('does not offer a whole-chapter target for selection-only task %s', (action) => {
  setup()
  act(() => editor().dispatch({ selection: { anchor: 3, head: 11 } }))
  if (action === 'polish') fireEvent.click(screen.getByRole('button', { name: '润色' }))
  else fireEvent.change(screen.getByRole('combobox', { name: '更多任务' }), { target: { value: action } })
  expect((screen.getByRole('button', { name: '使用整章' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/仅处理选区；如需处理整章/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '摘要' }))
  expect((screen.getByRole('button', { name: '使用整章' }) as HTMLButtonElement).disabled).toBe(false)
})

it('writes a protection snapshot before replacing all matches and preserves undo', async () => {
  let finish!: () => void
  mocks.createHistorySnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  setup()
  act(() => {
    openSearchPanel(editor())
    editor().dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '很', replace: '非常' })) })
    replaceAll(editor())
  })
  expect(editor().state.doc.toString()).toBe(content)
  expect(mocks.createHistorySnapshot).toHaveBeenCalledWith(expect.objectContaining({ content, kind: 'protected', name: '全部替换' }))
  await act(async () => finish())
  expect(editor().state.doc.toString()).toBe(content.replaceAll('很', '非常'))
  act(() => { undo(editor()) })
  expect(editor().state.doc.toString()).toBe(content)
})
