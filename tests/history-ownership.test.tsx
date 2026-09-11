import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ createHistorySnapshot: vi.fn(async () => {}), getDocument: vi.fn(), aiComplete: vi.fn(), listHistoryPage: vi.fn(), readHistory: vi.fn(), restoreHistory: vi.fn() }))
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
  mocks.listHistoryPage.mockResolvedValueOnce([revision]).mockImplementation(() => new Promise(() => {}))
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

it('saves a named version of the current unsaved body and exposes old named versions', async () => {
  const items = Array.from({ length: 101 }, (_, i) => ({ id: 'version-' + i, nodeId: node.id, nodeTitle: '章', reason: i === 100 ? '命名版本：旧结局' : '自动保存', wordCount: 4, createdAt: '2026-01-01T01:02:03Z', path: 'history/test.md' }))
  mocks.listHistoryPage.mockImplementation(async ({filter}) => filter === 'named' ? items.filter(item => item.reason.startsWith('命名版本：')) : items)
  render(<ContextMenuProvider fallbackItems={[]}><Inspector /></ContextMenuProvider>)
  fireEvent.click(screen.getByRole('button', { name: '版本历史' }))
  await screen.findByRole('button', { name: /加载更早版本/ })
  fireEvent.change(screen.getByRole('combobox', { name: '筛选历史版本' }), { target: { value: 'named' } })
  expect(await screen.findByText('命名版本：旧结局')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
  const dialog = screen.getByRole('dialog', { name: '保存命名版本' })
  fireEvent.change(within(dialog).getByLabelText('版本名称'), { target: { value: '结局修改前' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '保存版本' }))
  await waitFor(() => expect(mocks.createHistorySnapshot).toHaveBeenCalledWith({ projectPath: 'A', nodeId: node.id, content: 'A原选区与正文', kind: 'named', name: '结局修改前' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '保存命名版本' })).toBeNull())
})

it('loads history only when open, refreshes on history events, and pages by cursor', async () => {
 const items=Array.from({length:101},(_,i)=>({id:'h'+i,nodeId:node.id,nodeTitle:'章',reason:'版本'+i,wordCount:1,createdAt:'2026-09-11T00:00:00Z',path:'test'}))
 mocks.listHistoryPage.mockImplementation(async ({before})=>before?items.slice(100):items)
 render(<ContextMenuProvider fallbackItems={[]}><Inspector /></ContextMenuProvider>)
 act(()=>{for(let i=0;i<10;i++) useAppStore.getState().updateContent('修改'+i)})
 expect(mocks.listHistoryPage).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'版本历史'}))
 await screen.findByText('版本0')
 act(()=>{for(let i=10;i<20;i++) useAppStore.getState().updateContent('修改'+i)})
 expect(mocks.listHistoryPage).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByText('加载更早版本'))
 await screen.findByText('版本100')
 expect(mocks.listHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({before:'h99'}))
 act(()=>window.dispatchEvent(new Event('novelforge:history-changed')))
 await waitFor(()=>expect(mocks.listHistoryPage).toHaveBeenCalledTimes(3))
 expect(mocks.listHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({before:undefined}))
}, 15000)
