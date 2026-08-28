import { describe, expect, it } from 'vitest'
import { contentNumber, reorderItems, sortPlanningEntities } from '../src/lib/planning-data'
import type { EntityRecord } from '../src/lib/types'

function scene(id: string, order?: number, createdAt = id): EntityRecord {
  return { id, kind: 'scene', title: id, content: order === undefined ? {} : { order }, tags: [], filePath: id + '.md', createdAt, updatedAt: createdAt }
}

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
