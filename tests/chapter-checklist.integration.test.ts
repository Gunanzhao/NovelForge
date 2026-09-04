import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityRecord, NodeRecord, ProjectData, Stats } from '../src/lib/types'

const api = vi.hoisted(() => ({
  createNode: vi.fn(),
  upsertEntity: vi.fn(),
  stats: vi.fn(),
}))
vi.mock('../src/lib/api', () => ({ projectApi: api }))

import { useAppStore } from '../src/stores/app-store'

const volume: NodeRecord = {
  id: 'volume', kind: 'volume', parentId: null, title: '第一卷', orderIndex: 0, status: 'draft',
  filePath: 'manuscript/volume', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const template: EntityRecord = {
  id: 'template', kind: 'checklist-template', title: '模板', content: { items: [{ id: 'custom', label: '自定义检查' }] }, tags: [],
  filePath: 'checklists/template.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const project: ProjectData = {
  project: {
    formatVersion: 1, id: 'p', title: '测试', author: '', description: '', genre: '', targetWords: 1000,
    createdAt: '', updatedAt: '',
  },
  nodes: [volume],
  entities: [template],
  recovery: [],
}
const stats: Stats = {
  totalWords: 0, todayWords: 0, yesterdayWords: 0, weekWords: 0, monthWords: 0, chapterCount: 1,
  targetWords: 1000, writingStreak: 0, daily: [], chapterStats: [],
}

describe('chapter checklist store integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.stats.mockResolvedValue(stats)
    useAppStore.setState({ projectPath: 'project', data: project, document: null, error: null })
  })

  it('copies the project template after a chapter is created', async () => {
    const chapter: NodeRecord = {
      ...volume, id: 'chapter', kind: 'chapter', parentId: volume.id, title: '第一章', filePath: 'manuscript/chapter.md',
    }
    const created = { ...project, nodes: [...project.nodes, chapter] }
    api.createNode.mockResolvedValue(created)
    api.upsertEntity.mockImplementation((input: { content: Record<string, unknown> }) => Promise.resolve({
      ...created,
      entities: [...created.entities, {
        id: 'checklist', kind: 'chapter-checklist', title: '第一章 · Checklist', content: input.content, tags: [],
        filePath: 'checklists/checklist.md', createdAt: '', updatedAt: '',
      }],
    }))
    await useAppStore.getState().createNode('chapter', '第一章', volume.id)
    expect(api.upsertEntity).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'chapter-checklist',
      content: {
        chapterId: 'chapter',
        workflowStatus: 'draft',
        items: [{ id: 'custom', label: '自定义检查', completed: false }],
      },
    }))
    expect(useAppStore.getState().data?.entities.some((item) => item.kind === 'chapter-checklist')).toBe(true)
  })
})
