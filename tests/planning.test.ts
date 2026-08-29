import { describe, expect, it } from 'vitest'
import {
  contentNumber, filterTimelineEntities, findChapterByReference, isOpenForeshadowingStatus, normalizeForeshadowingStatus, reorderItems,
  sortChapterNodes,
  sortPlanningEntities, sortTimelineEntities,
} from '../src/lib/planning-data'
import type { EntityRecord, NodeRecord } from '../src/lib/types'

function scene(id: string, order?: number, createdAt = id): EntityRecord {
  return { id, kind: 'scene', title: id, content: order === undefined ? {} : { order }, tags: [], filePath: id + '.md', createdAt, updatedAt: createdAt }
}

function timeline(id: string, date: string, time = '', createdAt = id, tags: string[] = []): EntityRecord {
  return { id, kind: 'timeline', title: id, content: { date, time }, tags, filePath: id + '.md', createdAt, updatedAt: createdAt }
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

  it('filters timeline events by query, character, location and chapter', () => {
    const events = [
      { ...timeline('harbor', '2026-08-29'), content: { date: '2026-08-29', characters: '林月', location: '雾港', chapters: '第一章' } },
      { ...timeline('mountain', '2026-08-30'), content: { date: '2026-08-30', characters: '顾川', location: '青崖', chapters: '第二章' } },
    ]
    expect(filterTimelineEntities(events, { character: '林月' }).map((item) => item.id)).toEqual(['harbor'])
    expect(filterTimelineEntities(events, { location: '青崖' }).map((item) => item.id)).toEqual(['mountain'])
    expect(filterTimelineEntities(events, { chapter: '第二章' }).map((item) => item.id)).toEqual(['mountain'])
    expect(filterTimelineEntities(events, { query: '雾港' }).map((item) => item.id)).toEqual(['harbor'])
    expect(filterTimelineEntities([{ ...timeline('tagged', '2026-08-31', '', 'tagged', ['转折']) }], { query: '转折' }).map((item) => item.id)).toEqual(['tagged'])
  })

  it('resolves chapter title and chapter number references', () => {
    expect(findChapterByReference(chapters, '第二章')?.id).toBe('chapter-2')
    expect(findChapterByReference(chapters, '第 1 章')?.id).toBe('chapter-1')
    expect(findChapterByReference(chapters, '第 9 章')).toBeUndefined()
  })

  it('sorts chapters by volume order before the volume-local order', () => {
    const nodes: NodeRecord[] = [
      { id: 'volume-2', kind: 'volume', parentId: null, title: '第二卷', orderIndex: 1, status: 'not-started', filePath: 'volume-2', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'chapter-3', kind: 'chapter', parentId: 'volume-2', title: '卷二开端', orderIndex: 0, status: 'draft', filePath: 'chapter-3.md', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      { id: 'volume-1', kind: 'volume', parentId: null, title: '第一卷', orderIndex: 0, status: 'not-started', filePath: 'volume-1', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'chapter-2', kind: 'chapter', parentId: 'volume-1', title: '卷一收束', orderIndex: 1, status: 'draft', filePath: 'chapter-2.md', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
      { id: 'chapter-1', kind: 'chapter', parentId: 'volume-1', title: '卷一开端', orderIndex: 0, status: 'draft', filePath: 'chapter-1.md', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ]
    expect(sortChapterNodes(nodes).map((chapter) => chapter.id)).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])
    expect(findChapterByReference(nodes, '第3章')?.id).toBe('chapter-3')
    expect(findChapterByReference(nodes, '卷二开端')?.id).toBe('chapter-3')
  })

  it('normalizes legacy foreshadowing status labels', () => {
    expect(normalizeForeshadowingStatus('已埋设')).toBe('planted')
    expect(normalizeForeshadowingStatus('部分回收')).toBe('partial')
    expect(normalizeForeshadowingStatus('resolved')).toBe('paid-off')
    expect(normalizeForeshadowingStatus('未知状态')).toBe('planned')
    expect(isOpenForeshadowingStatus('部分回收')).toBe(true)
    expect(isOpenForeshadowingStatus('已回收')).toBe(false)
    expect(isOpenForeshadowingStatus('废弃')).toBe(false)
  })
})
