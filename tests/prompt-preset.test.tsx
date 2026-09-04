import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

const api = vi.hoisted(() => ({
  getDocument: vi.fn(),
  aiComplete: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({ isDesktop: false, projectApi: api }))

import { AiAssistantView } from '../src/components/AiAssistantView'
import { useAppStore } from '../src/stores/app-store'

const chapter: NodeRecord = {
  id: 'chapter-1', kind: 'chapter', parentId: 'volume', title: '第一章', orderIndex: 0,
  status: 'draft', filePath: 'manuscript/chapter-1.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

function preset(action: 'analyze' | 'rewrite', prompt: string): EntityRecord {
  return {
    id: `preset-${action}`, kind: 'prompt-preset', title: action === 'analyze' ? 'OOC 检查' : '选区改写',
    content: { description: '测试模板', prompt, action, defaultContexts: [] }, tags: ['AI 模板'],
    filePath: `prompts/${action}.md`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

const project: ProjectData = {
  project: {
    formatVersion: 1, id: 'project', title: '测试', author: '', description: '', genre: '', targetWords: 1000,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  },
  nodes: [
    { ...chapter, id: 'volume', kind: 'volume', parentId: null },
    chapter,
  ],
  entities: [
    preset('analyze', '分析 {{currentChapter}}'),
    preset('rewrite', '改写 {{selection}}'),
  ],
  recovery: [],
}

describe('PromptPresetManager integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      projectPath: 'project',
      data: project,
      document: { node: chapter, content: '林月推开门。' },
      editorSelection: null,
      selectedEntityId: null,
      error: null,
    })
  })

  it('shows the final prompt before running a local preset', async () => {
    render(<AiAssistantView />)
    fireEvent.click(screen.getByRole('button', { name: /OOC 检查/ }))
    await waitFor(() => expect(screen.getByDisplayValue('分析 {{currentChapter}}')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    expect(await screen.findByRole('dialog', { name: 'Prompt 预览 · OOC 检查' })).toBeTruthy()
    expect(screen.getByText(/字符数：/)).toBeTruthy()
    expect(screen.getByText(/当前章节 ·/)).toBeTruthy()
    expect(screen.getByText(/分析 林月推开门/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认运行' }))
    expect(await screen.findByDisplayValue(/【本地模板草稿】/)).toBeTruthy()
    expect(api.aiComplete).not.toHaveBeenCalled()
  })

  it('blocks rewrite execution when the required selection is missing', async () => {
    render(<AiAssistantView />)
    fireEvent.click(screen.getByRole('button', { name: /选区改写/ }))
    await waitFor(() => expect(screen.getByDisplayValue('改写 {{selection}}')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    await waitFor(() => expect(useAppStore.getState().error).toContain('当前没有可用选区'))
    expect(screen.queryByRole('dialog', { name: /Prompt 预览/ })).toBeNull()
    expect(api.aiComplete).not.toHaveBeenCalled()
  })
})
