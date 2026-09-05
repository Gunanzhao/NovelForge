import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

const api = vi.hoisted(() => ({ upsertEntity: vi.fn(), deleteEntity: vi.fn() }))
vi.mock('../src/lib/api', () => ({ projectApi: api }))

import { InboxView, QuickInboxCapture } from '../src/components/InboxView'
import { useAppStore } from '../src/stores/app-store'

const chapter: NodeRecord = {
  id: 'chapter', kind: 'chapter', parentId: 'volume', title: '第一章', orderIndex: 0, status: 'draft',
  filePath: 'manuscript/chapter.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const inbox: EntityRecord = {
  id: 'inbox-1', kind: 'inbox', title: '钟声线索', content: { content: '午夜钟声。', processed: false }, tags: ['悬疑'],
  filePath: 'inbox/inbox-1.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const project: ProjectData = {
  project: {
    formatVersion: 1, id: 'project', title: '测试', author: '', description: '', genre: '', targetWords: 1000,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  },
  nodes: [chapter],
  entities: [inbox],
  recovery: [],
}

describe('inbox integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ projectPath: 'project', data: project, document: { node: chapter, content: '' }, error: null })
  })

  it('opens Ctrl+Shift+I capture and saves the original content', async () => {
    const captured: EntityRecord = { ...inbox, id: 'inbox-2', title: '新的灵感', content: { content: '新的灵感', processed: false } }
    api.upsertEntity.mockResolvedValue({ ...project, entities: [...project.entities, captured] })
    render(<QuickInboxCapture />)
    act(() => window.dispatchEvent(new Event('novelforge:quick-inbox')))
    expect(await screen.findByRole('dialog', { name: '快速记录灵感' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('先记下来，稍后整理…'), { target: { value: '新的灵感' } })
    fireEvent.click(screen.getByRole('button', { name: '保存灵感' }))
    await waitFor(() => expect(api.upsertEntity).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'inbox',
      content: { content: '新的灵感', processed: false },
    })))
  })

  it('keeps the inbox item unprocessed when target creation fails', async () => {
    api.upsertEntity.mockRejectedValueOnce(new Error('目标创建失败'))
    render(<InboxView />)
    fireEvent.click(screen.getByRole('button', { name: '转为人物' }))
    await waitFor(() => expect(useAppStore.getState().error).toContain('目标创建失败'))
    expect(useAppStore.getState().data?.entities.find((item) => item.id === inbox.id)?.content.processed).toBe(false)
    expect(api.upsertEntity).toHaveBeenCalledTimes(1)
  })

  it('does not retain a selected item hidden by the processed tab', () => {
    const processed = { ...inbox, id: 'processed', title: '已整理灵感', content: { content: '已归档正文', processed: true } }
    useAppStore.setState({ data: { ...project, entities: [inbox, processed] } })
    const { container } = render(<InboxView />)
    fireEvent.click(screen.getByRole('button', { name: /钟声线索/u }))
    fireEvent.click(screen.getByRole('button', { name: /^已整理/u }))
    expect(container.textContent).toContain('已归档正文')
    expect(container.textContent).not.toContain('午夜钟声。')
  })
})
