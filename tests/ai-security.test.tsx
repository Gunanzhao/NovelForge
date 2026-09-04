import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { aiComplete } = vi.hoisted(() => ({
  aiComplete: vi.fn(async () => ({ content: '生成结果', model: 'mock-model' })),
}))

vi.mock('../src/lib/api', () => ({
  isDesktop: true,
  projectApi: {
    aiComplete,
  },
}))

import { AiAssistantView } from '../src/components/AiAssistantView'
import { writeAiPreferences } from '../src/lib/ai-data'
import type { NodeRecord, ProjectData } from '../src/lib/types'
import { useAppStore } from '../src/stores/app-store'

const chapter: NodeRecord = {
  id: 'chapter-1',
  kind: 'chapter',
  parentId: 'volume-1',
  title: '第一章',
  orderIndex: 0,
  status: 'draft',
  filePath: 'manuscript/volume_001/chapter_001.md',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const data: ProjectData = {
  project: {
    formatVersion: 1,
    id: 'project-1',
    title: '测试项目',
    author: '测试',
    description: '',
    genre: '现代',
    targetWords: 1000,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  nodes: [chapter],
  entities: [],
  recovery: [],
}

describe('AiAssistantView insecure HTTP confirmation', () => {
  beforeEach(() => {
    aiComplete.mockClear()
    writeAiPreferences({ endpoint: 'http://provider.example/v1', model: 'mock-model' })
    useAppStore.setState({
      projectPath: 'D:/project',
      data,
      document: { node: chapter, content: '# 第一章\n\n正文' },
      editorSelection: null,
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    act(() => {
      useAppStore.setState({ projectPath: null, data: null, document: null, editorSelection: null })
    })
  })

  it('warns and confirms once for each remote HTTP endpoint in the current component session', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<AiAssistantView />)

    expect(screen.getByText(/该地址使用非加密 HTTP/u)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/1 项上下文/u)).toBeTruthy())

    await user.click(screen.getByRole('button', { name: '运行辅助' }))
    await waitFor(() => expect(aiComplete).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '运行辅助' }))
    await waitFor(() => expect(aiComplete).toHaveBeenCalledTimes(2))
    expect(confirm).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText('留空使用本地离线模式'), { target: { value: 'http://other.example/v1' } })
    await user.click(screen.getByRole('button', { name: '运行辅助' }))
    await waitFor(() => expect(aiComplete).toHaveBeenCalledTimes(3))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('does not send when the remote HTTP confirmation is rejected', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<AiAssistantView />)
    await waitFor(() => expect(screen.getByText(/1 项上下文/u)).toBeTruthy())

    await user.click(screen.getByRole('button', { name: '运行辅助' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(aiComplete).not.toHaveBeenCalled()
  })
})
