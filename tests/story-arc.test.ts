import { describe, expect, it } from 'vitest'
import {
  moveStoryArcMilestone, parseStoryArc, storyArcEntityInputContent, storyArcHealthIssues,
} from '../src/lib/story-arc-data'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

function chapter(id: string, orderIndex: number): NodeRecord {
  return {
    id,
    kind: 'chapter',
    parentId: 'volume',
    title: `第${orderIndex + 1}章`,
    orderIndex,
    status: 'draft',
    filePath: `manuscript/${id}.md`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function arc(content: Record<string, unknown>): EntityRecord {
  return {
    id: 'arc-1',
    kind: 'story-arc',
    title: '寻找星核',
    content,
    tags: ['剧情线'],
    filePath: 'story-arcs/arc-1.md',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function project(storyArc: EntityRecord, chapters = Array.from({ length: 8 }, (_, index) => chapter(`c${index + 1}`, index))): ProjectData {
  return {
    project: {
      formatVersion: 1,
      id: 'project',
      title: '测试',
      author: '',
      description: '',
      genre: '',
      targetWords: 1000,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    nodes: chapters,
    entities: [storyArc],
    recovery: [],
  }
}

describe('story arc', () => {
  it('normalizes persisted fields and milestone order', () => {
    const parsed = parseStoryArc(arc({
      status: 'active',
      priority: 3,
      chapterIds: ['c1', 'c1', 'c2'],
      milestones: [
        { id: 'm2', title: '失败', order: 2, status: 'completed', chapterId: 'c2' },
        { id: 'm1', title: '线索', order: 0, status: 'planned' },
      ],
    }))
    expect(parsed.status).toBe('active')
    expect(parsed.chapterIds).toEqual(['c1', 'c2'])
    expect(parsed.milestones.map((item) => [item.id, item.order])).toEqual([['m1', 0], ['m2', 1]])
  })

  it('reorders milestones deterministically', () => {
    const milestones = parseStoryArc(arc({
      milestones: [
        { id: 'm1', title: '一', order: 0 },
        { id: 'm2', title: '二', order: 1 },
        { id: 'm3', title: '三', order: 2 },
      ],
    })).milestones
    expect(moveStoryArcMilestone(milestones, 'm3', 'm1').map((item) => [item.id, item.order])).toEqual([
      ['m3', 0], ['m1', 1], ['m2', 2],
    ])
  })

  it('reports invalid chapter references and completed arcs with open milestones', () => {
    const issues = storyArcHealthIssues(project(arc({
      status: 'completed',
      chapterIds: ['c1', 'deleted'],
      milestones: [
        { id: 'm1', title: '遗留节点', order: 0, status: 'planned' },
        { id: 'm2', title: '孤立节点', order: 1, status: 'completed', chapterId: 'missing' },
      ],
    })))
    expect(issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'broken-story-arc-chapter',
      'story-arc-completed-with-open-milestone',
      'story-arc-orphan-milestone',
    ]))
  })

  it('reports an active arc that has not advanced for five chapters', () => {
    const issues = storyArcHealthIssues(project(arc({
      status: 'active',
      chapterIds: ['c1'],
      milestones: [{ id: 'm1', title: '终点', order: 0, status: 'planned' }],
    })))
    expect(issues.some((item) => item.code === 'story-arc-stale')).toBe(true)
  })

  it('does not report healthy active and completed arcs', () => {
    const active = storyArcHealthIssues(project(arc({
      status: 'active',
      chapterIds: ['c8'],
      milestones: [{ id: 'm1', title: '终点', order: 0, status: 'planned', chapterId: 'c8' }],
    })))
    expect(active).toHaveLength(0)
    const completed = storyArcHealthIssues(project(arc({
      status: 'completed',
      chapterIds: ['c8'],
      milestones: [{ id: 'm1', title: '终点', order: 0, status: 'completed', chapterId: 'c8' }],
    })))
    expect(completed).toHaveLength(0)
  })

  it('serializes unique chapter links and stable milestone positions', () => {
    const content = storyArcEntityInputContent({
      description: '说明',
      status: 'planned',
      color: '#fff000',
      priority: 2.8,
      chapterIds: ['c1', 'c1'],
      milestones: [
        { id: 'm1', title: '一', order: 8, status: 'planned' },
        { id: 'm2', title: '二', order: 3, status: 'completed' },
      ],
    })
    expect(content.chapterIds).toEqual(['c1'])
    expect(content.priority).toBe(2)
    expect((content.milestones as Array<{ order: number }>).map((item) => item.order)).toEqual([0, 1])
  })
})
