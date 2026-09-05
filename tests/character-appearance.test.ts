import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentionIndex } from '../src/lib/mention-detection'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

const api = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('../src/lib/api', () => ({ projectApi: api }))

import {
  buildCharacterAppearance, chapterMentionRows, clearProjectMentionIndex, matrixWindow, scanProjectMentionIndex,
} from '../src/lib/character-appearance'

function node(id: string, kind: NodeRecord['kind'], orderIndex: number, parentId: string | null): NodeRecord {
  return {
    id, kind, parentId, title: id, orderIndex, status: 'draft', filePath: `manuscript/${id}.md`,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: `2026-01-01T00:00:${String(orderIndex).padStart(2, '0')}Z`,
  }
}

function entity(id: string, kind: EntityRecord['kind'], title: string): EntityRecord {
  return {
    id, kind, title, content: {}, tags: [], filePath: `${kind}/${id}.md`,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

function data(): ProjectData {
  return {
    project: {
      formatVersion: 1, id: 'p1', title: '测试', author: '', description: '', genre: '', targetWords: 1000,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    },
    nodes: [
      node('v1', 'volume', 0, null),
      node('c1', 'chapter', 0, 'v1'),
      node('s1', 'section', 0, 'c1'),
      node('c2', 'chapter', 1, 'v1'),
      node('c3', 'chapter', 2, 'v1'),
    ],
    entities: [
      entity('alice', 'character', '林月'),
      entity('bob', 'character', '陈默'),
      entity('harbor', 'location', '雾港'),
    ],
    recovery: [],
  }
}

function mention(entityId: string, kind: 'character' | 'location', start: number) {
  return {
    id: `${entityId}-${start}`, text: entityId, kind, start, end: start + entityId.length,
    entityId, status: 'known' as const, confidence: 1,
  }
}

describe('character appearance analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearProjectMentionIndex()
  })

  it('aggregates sections into chapters and calculates first/recent appearances', () => {
    const index: MentionIndex = {
      byDocument: {
        c1: [mention('alice', 'character', 0), mention('harbor', 'location', 8)],
        s1: [mention('alice', 'character', 0), mention('bob', 'character', 8)],
        c2: [mention('bob', 'character', 0)],
        c3: [mention('alice', 'character', 0), mention('bob', 'character', 8), mention('harbor', 'location', 16)],
      },
      byEntity: {},
    }
    const project = data()
    const appearance = buildCharacterAppearance(project, index, 'alice')
    expect(appearance?.firstChapter?.id).toBe('c1')
    expect(appearance?.recentChapter?.id).toBe('c3')
    expect(appearance?.chapters.map((item) => [item.node.id, item.mentions])).toEqual([['c1', 2], ['c3', 1]])
    expect(appearance?.totalMentions).toBe(3)
    expect(appearance?.companions.map((item) => [item.entity.id, item.chapters])).toEqual([['bob', 2]])
    expect(appearance?.locations.map((item) => [item.entity.id, item.chapters])).toEqual([['harbor', 2]])
    expect(chapterMentionRows(project, index)).toHaveLength(3)
  })

  it('loads documents in bounded batches and reuses the cache until forced', async () => {
    const project = data()
    project.nodes = [node('v1', 'volume', 0, null), ...Array.from({ length: 45 }, (_, index) => node(`c${index}`, 'chapter', index, 'v1'))]
    project.entities = [entity('alice', 'character', '林月')]
    api.getDocument.mockImplementation(({ nodeId }: { nodeId: string }) => Promise.resolve({
      node: project.nodes.find((item) => item.id === nodeId),
      content: nodeId === 'c2' ? '林月走进房间。' : '',
    }))
    const first = await scanProjectMentionIndex('project-path', project)
    expect(api.getDocument).toHaveBeenCalledTimes(45)
    expect(first.byEntity.alice).toEqual([{ nodeId: 'c2', count: 1 }])
    await scanProjectMentionIndex('project-path', project)
    expect(api.getDocument).toHaveBeenCalledTimes(45)
    await scanProjectMentionIndex('project-path', project, true)
    expect(api.getDocument).toHaveBeenCalledTimes(90)
  })

  it('windows large matrices instead of rendering every cell', () => {
    const chapters = Array.from({ length: 1000 }, (_, index) => index)
    const characters = Array.from({ length: 100 }, (_, index) => index)
    const chapterPage = matrixWindow(chapters, 24, 40)
    const characterPage = matrixWindow(characters, 8, 12)
    expect(chapterPage.items).toHaveLength(40)
    expect(chapterPage.items[0]).toBe(960)
    expect(chapterPage.pageCount).toBe(25)
    expect(characterPage.items).toHaveLength(4)
    expect(characterPage.pageCount).toBe(9)
  })

  it('does not let a slower forced scan replace the newest cached index', async () => {
    const project = data()
    project.nodes = [node('c1', 'chapter', 0, null)]
    let finishOld: ((value: { content: string }) => void) | undefined
    api.getDocument.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ content: '陈默说。' })
    const old = scanProjectMentionIndex('race', project, true)
    const newest = await scanProjectMentionIndex('race', project, true)
    finishOld?.({ content: '林月说。' })
    await old
    expect(await scanProjectMentionIndex('race', project)).toBe(newest)
    expect(newest.byEntity.bob).toEqual([{ nodeId: 'c1', count: 1 }])
    expect(api.getDocument).toHaveBeenCalledTimes(2)
  })
})
