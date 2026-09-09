import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), aiComplete: vi.fn(), listHistory: vi.fn(), readHistory: vi.fn(), restoreHistory: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: mocks }))
import { AiAssistantView } from '../src/components/AiAssistantView'
vi.mock('../src/components/NameGenerator', () => ({ NameGenerator: () => null }))
vi.mock('../src/components/MentionInspector', () => ({ MentionInspector: () => null }))
vi.mock('../src/components/StoryArcInspector', () => ({ StoryArcInspector: () => null }))
vi.mock('../src/components/ChapterWorkflow', () => ({ ChapterChecklistInspector: () => null }))
import { useAppStore } from '../src/stores/app-store'
import { useAiTask } from '../src/stores/ai-task'
import { writeAiPreferences } from '../src/lib/ai-data'
import { decideDraftNavigation } from '../src/lib/draft-guard'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'
const node = { id: 'chapter', parentId: 'volume', kind: 'chapter', title: '当前章', orderIndex: 1, status: 'draft', filePath: 'chapter.md' } as NodeRecord
const preset = { id: 'preset', kind: 'prompt-preset', title: '合成改写模板', content: { prompt: '改写 {{selection}}，参考 {{recentChapters:3}}', action: 'rewrite' }, tags: [] } as unknown as EntityRecord
const data = { project: { id: 'A' }, nodes: [{...node,id:'previous',orderIndex:0}, node], entities: [preset], recovery: [] } as unknown as ProjectData
beforeEach(() => {
  vi.clearAllMocks()
  useAiTask.setState(useAiTask.getInitialState(), true)
  useAppStore.setState({ ...useAppStore.getInitialState(), data, projectPath: 'A', projectSession: 1, document: { node, content: 'A原选区与正文' }, editorSelection: { nodeId: node.id, from: 0, to: 4, text: 'A原选区' }, activeView: 'ai' })
  writeAiPreferences({ mode: 'provider', endpoint: 'https://example.invalid/v1', model: 'synthetic' })
  mocks.aiComplete.mockResolvedValue({ content: '模型改写内容', model: 'synthetic' })
})
afterEach(async () => { await decideDraftNavigation('cancel'); cleanup() })

it('discards pending template previews after closing and switching projects', async () => {
  let resolve!: (value: unknown) => void
  mocks.getDocument.mockReturnValue(new Promise(done => { resolve = done }))
  render(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
  fireEvent.click(screen.getByRole('button', { name: /合成改写模板/ }))
  fireEvent.click(screen.getByRole('button', { name: '运行' }))
  await waitFor(() => expect(mocks.getDocument).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  act(() => useAppStore.setState({ projectPath: 'B', projectSession: 2, data: { ...data, project: { ...data.project, id: 'B' } }, document: { node, content: 'B原选区与正文' }, editorSelection: { nodeId: node.id, from: 0, to: 4, text: 'B原选区' } }))
  await act(async () => resolve({ node: {...node,id:'previous'}, content: 'OLD_PROJECT_REFERENCE' }))
  fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
  expect(screen.queryByRole('dialog', { name: /Prompt 预览/ })).toBeNull()
  expect(mocks.aiComplete).not.toHaveBeenCalled()
  expect(useAppStore.getState().document?.content).toBe('B原选区与正文')
})

it.each(['content', 'selection', 'chapter'])('invalidates an already visible preview when %s changes', async (change) => {
  mocks.getDocument.mockResolvedValue({ node, content: '参考内容' })
  render(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
  fireEvent.click(screen.getByRole('button', { name: /合成改写模板/ }))
  fireEvent.click(screen.getByRole('button', { name: '运行' }))
  await screen.findByRole('dialog', { name: /Prompt 预览/ })
  act(() => {
    if (change === 'content') useAppStore.setState({ document: { node, content: '已修改正文' } })
    if (change === 'selection') useAppStore.setState({ editorSelection: { nodeId: node.id, from: 4, to: 5, text: '与' } })
    if (change === 'chapter') useAppStore.setState({ document: { node: { ...node, id: 'previous' }, content: '另一章' } })
  })
  expect(screen.queryByRole('button', { name: '确认运行' })).toBeNull()
  expect(mocks.aiComplete).not.toHaveBeenCalled()
})
