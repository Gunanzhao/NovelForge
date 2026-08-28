import { describe, expect, it } from 'vitest'
import { fallbackInvoke } from '../src/lib/fallback'
import type { EntityRecord, ProjectData, ProjectInput } from '../src/lib/types'

const input: ProjectInput = {
  path: 'browser-planning-project', title: '规划测试', author: '测试作者', description: '', genre: '现代', targetWords: 10000,
}

describe('planning fallback workflow', () => {
  it('persists chapter-linked outlines and ordered scene cards', async () => {
    const created = await fallbackInvoke<ProjectData>('create_project', { input })
    const chapter = created.nodes.find((node) => node.kind === 'chapter')
    expect(chapter).toBeDefined()
    if (!chapter) return

    await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: input.path, kind: 'outline', id: null, title: '第一章大纲',
      content: { chapterId: chapter.id, goal: '建立悬念', conflict: '主角与雾港守门人冲突', result: '得到线索' }, tags: ['章节大纲'],
    } })
    await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: input.path, kind: 'scene', id: null, title: '钟楼',
      content: { chapterId: chapter.id, order: 0, pov: '林月' }, tags: ['场景卡'],
    } })
    await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: input.path, kind: 'scene', id: null, title: '码头',
      content: { chapterId: chapter.id, order: 1, pov: '林月' }, tags: ['场景卡'],
    } })

    const outlines = await fallbackInvoke<EntityRecord[]>('list_entities', { path: input.path, kind: 'outline' })
    const scenes = await fallbackInvoke<EntityRecord[]>('list_entities', { path: input.path, kind: 'scene' })
    expect(outlines[0]?.content.chapterId).toBe(chapter.id)
    expect(scenes.map((scene) => scene.content.order)).toEqual([0, 1])
    expect(scenes.every((scene) => scene.content.chapterId === chapter.id)).toBe(true)
  })
})
