import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NodeRecord, ProjectData } from '../src/lib/types'
const api = vi.hoisted(() => ({ aiComplete: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: api }))
import { AiAssistantView } from '../src/components/AiAssistantView'
import { useAppStore } from '../src/stores/app-store'
import { readAiPreferences, writeAiPreferences } from '../src/lib/ai-data'

const chapter: NodeRecord = { id: 'chapter', title: '雨夜', kind: 'chapter', parentId: null, orderIndex: 0, status: 'draft', filePath: 'chapter.md', createdAt: '', updatedAt: '' }
const data: ProjectData = { project: { id: 'project', title: '测试', author: '', description: '', genre: '', targetWords: 1000, formatVersion: 1, createdAt: '', updatedAt: '' }, nodes: [chapter], entities: [], recovery: [] }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  useAppStore.setState({ projectPath: 'project', data, document: { node: chapter, content: '雨落在信封上。' }, editorSelection: null, requestedAiAction: null, error: null })
  api.aiComplete.mockResolvedValue({ content: '门铃响了一声。', model: 'writer' })
})
afterEach(cleanup)

it('puts writing and results first and opens templates only on demand', () => {
  render(<AiAssistantView />)
  expect(screen.getByRole('region', { name: '写作任务与参考资料' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'AI 结果工作区' })).toBeTruthy()
  expect(screen.queryByPlaceholderText('人物 OOC 检查')).toBeNull()
  expect(screen.queryByLabelText('Base URL')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
  expect(screen.getByRole('dialog', { name: '写作模板' })).toBeTruthy()
})

it('preserves a template draft when closing and reopening its editor', () => {
  render(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
  fireEvent.change(screen.getByPlaceholderText('人物 OOC 检查'), { target: { value: '未保存模板' } })
  fireEvent.change(screen.getByPlaceholderText('请检查 {{character:林月}} 在 {{currentChapter}} 中的行为。'), { target: { value: '检查 {{currentChapter}}' } })
  fireEvent.click(within(screen.getByRole('dialog', { name: '写作模板' })).getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
  expect(screen.getByDisplayValue('未保存模板')).toBeTruthy()
  expect(screen.getByDisplayValue('检查 {{currentChapter}}')).toBeTruthy()
})

it('preserves provider fields and results across settings dismissal without persisting the key', async () => {
  writeAiPreferences({ mode: 'provider', endpoint: 'https://example.com/v1', model: 'writer' })
  render(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
  await screen.findByDisplayValue('门铃响了一声。')
  fireEvent.click(screen.getByRole('button', { name: '连接设置' }))
  fireEvent.change(screen.getByLabelText(/^API Key/), { target: { value: 'synthetic-key' } })
  fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '0' } })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByDisplayValue('门铃响了一声。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '连接设置' }))
  expect(screen.getByLabelText(/^API Key/)).toHaveProperty('value', 'synthetic-key')
  expect(readAiPreferences().temperature).toBe(0)
  expect(JSON.stringify(readAiPreferences())).not.toContain('synthetic-key')
})

it('previews without running and confirms once, then still protects changed source text', async () => {
  writeAiPreferences({ mode: 'provider', endpoint: 'https://example.com/v1', model: 'writer' })
  render(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '预览上下文' }))
  const preview = await screen.findByRole('dialog', { name: '请求预览' })
  expect(api.aiComplete).not.toHaveBeenCalled()
  fireEvent.click(within(preview).getByRole('button', { name: '确认运行' }))
  await screen.findByDisplayValue('门铃响了一声。')
  expect(api.aiComplete).toHaveBeenCalledTimes(1)
  act(() => useAppStore.setState({ document: { node: chapter, content: '已经修改的原文' } }))
  fireEvent.click(screen.getByRole('button', { name: '追加到正文' }))
  await waitFor(() => expect(useAppStore.getState().error).toContain('正文已变化'))
  expect(useAppStore.getState().document?.content).toBe('已经修改的原文')
})
