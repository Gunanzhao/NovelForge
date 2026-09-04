import { describe, expect, it } from 'vitest'
import {
  appendInboxMilestone, inboxConversionInput, inboxEntityContent, parseInboxItem,
} from '../src/lib/inbox-data'
import type { EntityRecord } from '../src/lib/types'

function entity(kind: EntityRecord['kind'], title: string, content: Record<string, unknown> = {}): EntityRecord {
  return {
    id: `${kind}-1`, kind, title, content, tags: ['悬疑'], filePath: `${kind}/${kind}-1.md`,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  }
}

describe('inbox data', () => {
  const record = entity('inbox', '钟声线索', { content: '午夜钟声只响了十一下。', processed: false })
  const item = parseInboxItem(record)

  it('round-trips inbox state and processed target', () => {
    expect(item).toMatchObject({ title: '钟声线索', content: '午夜钟声只响了十一下。', processed: false })
    expect(inboxEntityContent({ ...item, processed: true, processedInto: { kind: 'foreshadowing', id: 'f1' } })).toEqual({
      content: '午夜钟声只响了十一下。',
      processed: true,
      processedInto: { kind: 'foreshadowing', id: 'f1' },
    })
  })

  it.each([
    ['character', 'notes'],
    ['location', 'description'],
    ['world', 'description'],
    ['scene', 'result'],
    ['foreshadowing', 'description'],
    ['note', 'description'],
  ] as const)('creates a %s conversion without changing the source item', (kind, field) => {
    const input = inboxConversionInput('project', item, kind)
    expect(input.kind).toBe(kind)
    expect(input.title).toBe('钟声线索')
    expect(input.content[field]).toBe(item.content)
    expect(item.processed).toBe(false)
  })

  it('appends a planned milestone while preserving the existing story arc', () => {
    const arc = entity('story-arc', '主线', {
      description: '寻找真相',
      status: 'active',
      chapterIds: ['c1'],
      milestones: [{ id: 'm1', title: '发现钟楼', order: 0, status: 'completed' }],
    })
    const content = appendInboxMilestone(arc, item, 'm2')
    expect(content.description).toBe('寻找真相')
    expect(content.chapterIds).toEqual(['c1'])
    expect(content.milestones).toEqual([
      expect.objectContaining({ id: 'm1', order: 0 }),
      expect.objectContaining({ id: 'm2', title: '钟声线索', note: item.content, order: 1, status: 'planned' }),
    ])
  })
})
