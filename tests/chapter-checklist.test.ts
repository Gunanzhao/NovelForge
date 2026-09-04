import { describe, expect, it } from 'vitest'
import { fallbackInvoke } from '../src/lib/fallback'
import {
  chapterChecklistInput, chapterMatchesWorkflowFilter, checklistForChapter, checklistProgress,
  DEFAULT_CHECKLIST_TEMPLATE, parseChapterChecklist, parseChecklistTemplate, workflowDashboard,
} from '../src/lib/chapter-workflow'
import type { EntityRecord, NodeRecord, ProjectData, ProjectInput } from '../src/lib/types'

function node(id: string, kind: NodeRecord['kind'], parentId: string | null, orderIndex = 0): NodeRecord {
  return {
    id, kind, parentId, title: id, orderIndex, status: 'draft', filePath: `manuscript/${id}.md`,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

function entity(id: string, kind: EntityRecord['kind'], content: Record<string, unknown>): EntityRecord {
  return {
    id, kind, title: id, content, tags: [], filePath: `checklists/${id}.md`,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('chapter checklist', () => {
  it('uses the default template and preserves existing checklist state', () => {
    expect(parseChecklistTemplate().items).toEqual(DEFAULT_CHECKLIST_TEMPLATE.items)
    const checklist = parseChapterChecklist(entity('checklist', 'chapter-checklist', {
      chapterId: 'c1',
      workflowStatus: 'proofread-1',
      items: [
        { id: 'body-complete', label: '正文完成', completed: true },
        { id: 'polish', label: '润色', completed: false },
      ],
    }))
    expect(checklist.workflowStatus).toBe('proofread-1')
    expect(checklistProgress(checklist)).toEqual({ completed: 1, total: 2, percent: 50 })
  })

  it('copies the current template only when creating a new checklist', () => {
    const chapter = node('c1', 'chapter', 'v1')
    const template = entity('template', 'checklist-template', { items: [{ id: 'custom', label: '自定义检查' }] })
    const input = chapterChecklistInput('project', chapter, [template])
    expect(input.content).toEqual({
      chapterId: 'c1',
      workflowStatus: 'draft',
      items: [{ id: 'custom', label: '自定义检查', completed: false }],
    })
    const existing = { id: 'existing', chapterId: 'c1', workflowStatus: 'final' as const, items: [{ id: 'old', label: '旧检查', completed: true }] }
    expect(chapterChecklistInput('project', chapter, [template], existing).content.items).toEqual(existing.items)
  })

  it('filters unfinished, non-final and pending consistency chapters', () => {
    const chapter = node('c1', 'chapter', 'v1')
    const checklist = entity('checklist', 'chapter-checklist', {
      chapterId: 'c1',
      workflowStatus: 'proofread-1',
      items: [
        { id: 'body-complete', label: '正文完成', completed: true },
        { id: 'character-consistency', label: '人物一致性检查', completed: false },
      ],
    })
    expect(chapterMatchesWorkflowFilter(chapter, [checklist], 'incomplete')).toBe(true)
    expect(chapterMatchesWorkflowFilter(chapter, [checklist], 'not-final')).toBe(true)
    expect(chapterMatchesWorkflowFilter(chapter, [checklist], 'consistency')).toBe(true)
    const done = entity('done', 'chapter-checklist', {
      ...checklist.content,
      workflowStatus: 'final',
      items: (checklist.content.items as Array<Record<string, unknown>>).map((item) => ({ ...item, completed: true })),
    })
    expect(chapterMatchesWorkflowFilter(chapter, [done], 'incomplete')).toBe(false)
    expect(chapterMatchesWorkflowFilter(chapter, [done], 'not-final')).toBe(false)
    expect(chapterMatchesWorkflowFilter(chapter, [done], 'consistency')).toBe(false)
  })

  it('summarizes workflow progress by volume', () => {
    const volume = node('v1', 'volume', null)
    const first = node('c1', 'chapter', 'v1', 0)
    const second = node('c2', 'chapter', 'v1', 1)
    const data: ProjectData = {
      project: {
        formatVersion: 1, id: 'p', title: '测试', author: '', description: '', genre: '', targetWords: 1000,
        createdAt: '', updatedAt: '',
      },
      nodes: [volume, first, second],
      entities: [
        entity('a', 'chapter-checklist', { chapterId: 'c1', workflowStatus: 'final', items: [{ id: 'body', label: '正文完成', completed: true }] }),
        entity('b', 'chapter-checklist', { chapterId: 'c2', workflowStatus: 'draft', items: [{ id: 'body', label: '正文完成', completed: false }] }),
      ],
      recovery: [],
    }
    expect(workflowDashboard(data)[0]).toMatchObject({
      chapterCount: 2,
      finalCount: 1,
      itemProgress: [{ label: '正文完成', completed: 1, total: 2 }],
    })
  })

  it('browser fallback gives initial and newly created chapters independent checklist copies', async () => {
    const input: ProjectInput = { path: 'checklist-fallback', title: '流程测试', author: '', description: '', genre: '', targetWords: 1000 }
    let data = await fallbackInvoke<ProjectData>('create_project', { input })
    const volume = data.nodes.find((item) => item.kind === 'volume')
    const first = data.nodes.find((item) => item.kind === 'chapter')
    expect(volume && first).toBeTruthy()
    if (!volume || !first) return
    expect(checklistForChapter(data.entities, first.id)?.items).toHaveLength(7)
    data = await fallbackInvoke<ProjectData>('upsert_entity', {
      input: { projectPath: input.path, kind: 'checklist-template', id: null, title: '模板', content: { items: [{ id: 'mystery', label: '诡计检查' }] }, tags: [] },
    })
    data = await fallbackInvoke<ProjectData>('create_node', {
      input: { projectPath: input.path, kind: 'chapter', title: '第二章', parentId: volume.id },
    })
    const second = data.nodes.find((item) => item.title === '第二章')
    expect(second).toBeDefined()
    if (!second) return
    expect(checklistForChapter(data.entities, second.id)?.items.map((item) => item.label)).toEqual(['诡计检查'])
    expect(checklistForChapter(data.entities, first.id)?.items).toHaveLength(7)
  })
})
