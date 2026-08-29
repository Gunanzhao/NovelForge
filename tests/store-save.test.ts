import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentData, NodeRecord, ProjectData, Stats } from '../src/lib/types'

const api = vi.hoisted(() => ({
  saveDocument: vi.fn(),
  getDocument: vi.fn(),
  stats: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({ isDesktop: false, projectApi: api }))

import { useAppStore } from '../src/stores/app-store'

const chapterA: NodeRecord = {
  id: 'chapter-a', kind: 'chapter', parentId: 'volume', title: '第一章', orderIndex: 0,
  status: 'draft', filePath: 'manuscript/a.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const chapterB: NodeRecord = {
  id: 'chapter-b', kind: 'chapter', parentId: 'volume', title: '第二章', orderIndex: 1,
  status: 'draft', filePath: 'manuscript/b.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const projectData: ProjectData = {
  project: {
    formatVersion: 1, id: 'project', title: '测试项目', author: '', description: '', genre: '',
    targetWords: 10000, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  },
  nodes: [
    {
      id: 'volume', kind: 'volume', parentId: null, title: '第一卷', orderIndex: 0,
      status: 'not-started', filePath: 'manuscript/volume', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    },
    chapterA,
    chapterB,
  ],
  entities: [],
  recovery: [],
}
const emptyStats: Stats = {
  totalWords: 0, todayWords: 0, yesterdayWords: 0, weekWords: 0, monthWords: 0,
  chapterCount: 2, targetWords: 10000, writingStreak: 0,
}

function savedDocument(node: NodeRecord, content: string): DocumentData {
  return { node: { ...node, updatedAt: '2026-01-01T00:00:01Z' }, content }
}

describe('document save coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.stats.mockResolvedValue(emptyStats)
    useAppStore.setState({
      projectPath: 'project',
      data: projectData,
      document: { node: chapterA, content: '旧内容' },
      documentVersion: 0,
      saveState: 'idle',
      error: null,
    })
  })

  it('does not replace newer edits with a stale save response', async () => {
    let resolveFirst: ((value: DocumentData) => void) | undefined
    api.saveDocument
      .mockImplementationOnce(() => new Promise<DocumentData>((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce((input: { content: string }) => Promise.resolve(savedDocument(chapterA, input.content)))

    const saving = useAppStore.getState().saveCurrentDocument('自动保存')
    await vi.waitFor(() => expect(api.saveDocument).toHaveBeenCalledTimes(1))
    useAppStore.getState().updateContent('保存期间的新内容')
    resolveFirst?.(savedDocument(chapterA, '旧内容'))

    await expect(saving).resolves.toBe(true)
    expect(api.saveDocument).toHaveBeenCalledTimes(2)
    expect(api.saveDocument.mock.calls[1]?.[0].content).toBe('保存期间的新内容')
    expect(useAppStore.getState().document?.content).toBe('保存期间的新内容')
    expect(useAppStore.getState().saveState).toBe('saved')
  })

  it('saves a dirty chapter before loading another chapter', async () => {
    const order: string[] = []
    api.saveDocument.mockImplementation((input: { content: string }) => {
      order.push('save')
      return Promise.resolve(savedDocument(chapterA, input.content))
    })
    api.getDocument.mockImplementation(() => {
      order.push('load')
      return Promise.resolve(savedDocument(chapterB, '第二章内容'))
    })

    await useAppStore.getState().selectNode(chapterB.id)

    expect(order).toEqual(['save', 'load'])
    expect(useAppStore.getState().document?.node.id).toBe(chapterB.id)
    expect(useAppStore.getState().document?.content).toBe('第二章内容')
  })

  it('keeps the current chapter selected when the pre-navigation save fails', async () => {
    api.saveDocument.mockRejectedValueOnce(new Error('磁盘被占用'))

    await useAppStore.getState().selectNode(chapterB.id)

    expect(api.getDocument).not.toHaveBeenCalled()
    expect(useAppStore.getState().document?.node.id).toBe(chapterA.id)
    expect(useAppStore.getState().saveState).toBe('error')
    expect(useAppStore.getState().error).toContain('磁盘被占用')
  })
})
