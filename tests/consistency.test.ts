import { describe, expect, it } from 'vitest'
import { analyzeConsistency } from '../src/lib/consistency-data'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

const chapter: NodeRecord = {
  id: 'chapter-1', kind: 'chapter', parentId: 'volume-1', title: '第一章', orderIndex: 0, status: 'draft',
  filePath: 'manuscript/volume_001/chapter_001.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const volume2: NodeRecord = {
  id: 'volume-2', kind: 'volume', parentId: null, title: '第二卷', orderIndex: 1, status: 'not-started',
  filePath: 'manuscript/volume_002', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const chapter2: NodeRecord = {
  id: 'chapter-2', kind: 'chapter', parentId: 'volume-2', title: '卷二开端', orderIndex: 0, status: 'draft',
  filePath: 'manuscript/volume_002/chapter_001.md', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
}

function entity(id: string, kind: EntityRecord['kind'], title: string, content: Record<string, unknown>): EntityRecord {
  return { id, kind, title, content, tags: [], filePath: `${kind}/${id}.md`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
}

function project(entities: EntityRecord[]): ProjectData {
  return { project: { formatVersion: 1, id: 'project', title: '测试', author: '测试', description: '', genre: '', targetWords: 0, createdAt: '', updatedAt: '' }, nodes: [chapter], entities, recovery: [] }
}

describe('consistency analyzer', () => {
  it('reports broken links, references, duplicates and status mismatches', () => {
    const entities = [
      entity('a', 'character', '林月', {}),
      entity('b', 'character', '林月', {}),
      entity('relationship-1', 'relationship', '坏关系', { fromId: 'a', toId: 'missing', label: '敌对' }),
      entity('thread-1', 'foreshadowing', '钟声', { plannedPayoff: '第 99 章', actualPayoff: '第二章', status: 'planted' }),
    ]
    const report = analyzeConsistency(project(entities), { [chapter.id]: '林月在雾港看见[[守门人]]。' })
    expect(report.errors).toBe(1)
    expect(report.warnings).toBeGreaterThanOrEqual(4)
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining(['missing-wiki', 'duplicate-title', 'broken-relationship', 'missing-chapter-reference', 'foreshadowing-status']))
  })

  it('returns a clean report for linked project data', () => {
    const entities = [entity('a', 'character', '林月', {}), entity('b', 'character', '沈砚', {}), entity('relationship-1', 'relationship', '盟友', { fromId: 'a', toId: 'b', label: '盟友' })]
    const report = analyzeConsistency(project(entities), { [chapter.id]: '林月和沈砚在雾港相遇。' })
    expect(report.issueCount).toBe(0)
    expect(report.errors).toBe(0)
    expect(report.warnings).toBe(0)
  })

  it('resolves numeric chapter references across volume-local order indexes', () => {
    const data = { ...project([]), nodes: [chapter, volume2, chapter2] }
    const report = analyzeConsistency(data, {})
    expect(report.issueCount).toBe(0)
  })

  it('accepts chapter titles containing spaces and dashes', () => {
    const titledChapter = { ...chapter, title: '第二章 - CDP' }
    const timeline = entity('timeline-1', 'timeline', '事件', { chapters: '第二章 - CDP' })
    const data = { ...project([timeline]), nodes: [titledChapter] }
    const report = analyzeConsistency(data, {})
    expect(report.issueCount).toBe(0)
  })

  it('accepts legacy aliases for a paid-off foreshadowing status', () => {
    const thread = entity('thread-resolved', 'foreshadowing', '已回收旧伏笔', { actualPayoff: '第一章', status: 'resolved' })
    const report = analyzeConsistency(project([thread]), {})
    expect(report.issues.some((item) => item.code === 'foreshadowing-status')).toBe(false)
  })
})
