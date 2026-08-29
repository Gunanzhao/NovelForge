import { describe, expect, it } from 'vitest'
import { analyzeConsistency } from '../src/lib/consistency-data'
import { sortTimelineEntities } from '../src/lib/planning-data'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

describe('large project acceptance benchmark', () => {
  it('analyzes 1000 chapters and one million Chinese characters within the UI budget', () => {
    const chapters: NodeRecord[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `chapter-${index}`, kind: 'chapter', parentId: 'volume-1', title: `第${index + 1}章`, orderIndex: index, status: 'draft',
      filePath: `manuscript/volume_001/chapter_${String(index + 1).padStart(4, '0')}.md`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }))
    const content = '字'.repeat(1000)
    const documents = Object.fromEntries(chapters.map((chapter) => [chapter.id, content]))
    const project: ProjectData = { project: { formatVersion: 1, id: 'large', title: '大规模验收', author: '测试', description: '', genre: '', targetWords: 1_000_000, createdAt: '', updatedAt: '' }, nodes: chapters, entities: [], recovery: [] }
    const start = performance.now()
    const report = analyzeConsistency(project, documents)
    const elapsed = performance.now() - start
    expect(report.issueCount).toBe(0)
    expect(documents[chapters[999].id]).toHaveLength(1000)
    expect(elapsed).toBeLessThan(5000)
  })

  it('sorts a thousand timeline events without mutating the source array', () => {
    const events: EntityRecord[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `event-${index}`, kind: 'timeline', title: `事件${index}`, content: { date: `第${1000 - index}日`, time: '上午' }, tags: [], filePath: `timeline/${index}.md`,
      createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}Z`, updatedAt: '2026-01-01T00:00:00Z',
    }))
    const sourceFirst = events[0].id
    const sorted = sortTimelineEntities(events)
    expect(sorted).toHaveLength(1000)
    expect(sorted[0].content.date).toBe('第1日')
    expect(events[0].id).toBe(sourceFirst)
  })
})

