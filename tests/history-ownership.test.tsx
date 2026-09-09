import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), aiComplete: vi.fn(), listHistory: vi.fn(), readHistory: vi.fn(), restoreHistory: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: mocks }))
import { Inspector } from '../src/components/Inspector'
vi.mock('../src/components/NameGenerator', () => ({ NameGenerator: () => null }))
vi.mock('../src/components/MentionInspector', () => ({ MentionInspector: () => null }))
vi.mock('../src/components/StoryArcInspector', () => ({ StoryArcInspector: () => null }))
vi.mock('../src/components/ChapterWorkflow', () => ({ ChapterChecklistInspector: () => null }))
import { ContextMenuProvider } from '../src/components/ContextMenu'
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

it('clears chapter A history and preview while chapter B history is loading', async () => {
  const revision = { id:'revision-A',nodeId:node.id,nodeTitle:'A章',reason:'A章历史',wordCount:5,createdAt:'2026-01-01T00:00:00Z',path:'history/A.md' }
  mocks.listHistory.mockResolvedValueOnce([revision]).mockImplementation(() => new Promise(() => {}))
  mocks.readHistory.mockResolvedValue('A章旧内容')
  mocks.restoreHistory.mockResolvedValue(data)
  mocks.getDocument.mockResolvedValue({node:{...node,id:'previous'},content:'B章正文'})
  useAppStore.setState({saveState:'saved'})
  render(<ContextMenuProvider fallbackItems={[]}><Inspector /></ContextMenuProvider>)
  fireEvent.click(screen.getByRole('button',{name:'版本历史'}))
  await screen.findByText('A章历史')
  fireEvent.click(screen.getByRole('button',{name:'查看'}))
  await screen.findByText('A章旧内容')
  act(() => useAppStore.setState({document:{node:{...node,id:'previous'},content:'B章正文'},documentVersion:2}))
  expect(screen.queryByText('A章旧内容')).toBeNull()
  expect(screen.queryByText('A章历史')).toBeNull()
  expect(mocks.restoreHistory).not.toHaveBeenCalled()
})
