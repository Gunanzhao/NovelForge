import { describe, expect, it } from 'vitest'
import {
  contentNumber, findChapterByReference, normalizeForeshadowingStatus, reorderItems,
  sortPlanningEntities, sortTimelineEntities,
} from '../src/lib/planning-data'
import type { EntityRecord, NodeRecord } from '../src/lib/types'

function scene(id: string, order?: number, createdAt = id): EntityRecord {
  return { id, kind: 'scene', title: id, content: order === undefined ? {} : { order }, tags: [], filePath: id + '.md', createdAt, updatedAt: createdAt }
}

function timeline(id: string, date: string, time = '', createdAt = id): EntityRecord {
  return { id, kind: 'timeline', title: id, content: { date, time }, tags: [], filePath: id + '.md', createdAt, updatedAt: createdAt }
}

const chapters: NodeRecord[] = [
  { id: 'chapter-1', kind: 'chapter', parentId: 'volume', title: '第一章', orderIndex: 0, status: 'draft', filePath: 'chapter-1.md', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'chapter-2', kind: 'chapter', parentId: 'volume', title: '第二章', orderIndex: 1, status: 'draft', filePath: 'chapter-2.md', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
]

describe('planning data helpers', () => {
  it('uses explicit scene order and keeps unordered cards after ordered cards', () => {
    expect(sortPlanningEntities([scene('b'), scene('c', 1), scene('a', 0)]).map((item) => item.id)).toEqual(['a', 'c', 'b'])
    expect(contentNumber(scene('empty'), 'order', 7)).toBe(7)
  })

  it('reorders a dragged item without mutating the original array', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(reorderItems(items, 'c', 'a').map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(reorderItems(items, 'missing', 'a')).toBe(items)
  })
})

describe('timeline and foreshadowing planning helpers', () => {
  it('sorts dated events before undated events and keeps time order', () => {
    const sorted = sortTimelineEntities([
      timeline('undated', ''),
      timeline('late', '2026-08-29', '夜'),
      timeline('early', '2026-08-29', '早'),
      timeline('first', '2026-08-28'),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['first', 'early', 'late', 'undated'])
  })

  it('resolves chapter title and chapter number references', () => {
    expect(findChapterByReference(chapters, '第二章')?.id).toBe('chapter-2')
    expect(findChapterByReference(chapters, '第 1 章')?.id).toBe('chapter-1')
    expect(findChapterByReference(chapters, '第 9 章')).toBeUndefined()
  })

  it('normalizes legacy foreshadowing status labels', () => {
    expect(normalizeForeshadowingStatus('已埋设')).toBe('planted')
    expect(normalizeForeshadowingStatus('resolved')).toBe('paid-off')
    expect(normalizeForeshadowingStatus('未知状态')).toBe('planned')
  })
})
