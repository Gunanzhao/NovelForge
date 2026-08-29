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

  it('persists timeline events and foreshadowing status for dedicated views', async () => {
    const projectInput: ProjectInput = { ...input, path: 'browser-special-planning-project' }
    const created = await fallbackInvoke<ProjectData>('create_project', { input: projectInput })
    const chapter = created.nodes.find((node) => node.kind === 'chapter')
    expect(chapter).toBeDefined()
    if (!chapter) return

    await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: projectInput.path, kind: 'timeline', id: null, title: '雾港停电',
      content: { date: '2026-08-29', time: '晚上 21:30', description: '全城灯火熄灭', characters: '林月', location: '雾港', chapters: chapter.title },
      tags: ['时间线'],
    } })
    await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: projectInput.path, kind: 'foreshadowing', id: null, title: '钟楼的第三声钟响',
      content: { description: '提示守门人并非人类', plantedIn: chapter.title, plannedPayoff: '第二章', actualPayoff: '', status: 'planted', notes: '需要在回收时补充细节' },
      tags: ['伏笔'],
    } })

    const timeline = await fallbackInvoke<EntityRecord[]>('list_entities', { path: projectInput.path, kind: 'timeline' })
    const foreshadowing = await fallbackInvoke<EntityRecord[]>('list_entities', { path: projectInput.path, kind: 'foreshadowing' })
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.content).toMatchObject({ date: '2026-08-29', time: '晚上 21:30', chapters: chapter.title })
    expect(foreshadowing[0]?.content).toMatchObject({ status: 'planted', plantedIn: chapter.title })
  })

  it('persists character relationships for the graph workspace', async () => {
    const projectInput: ProjectInput = { ...input, path: 'browser-relationship-project' }
    const created = await fallbackInvoke<ProjectData>('create_project', { input: projectInput })
    const characterA = await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: projectInput.path, kind: 'character', id: null, title: '林月', content: { identity: '记者' }, tags: ['主角'],
    } })
    const characterB = await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: projectInput.path, kind: 'character', id: null, title: '沈砚', content: { identity: '守门人' }, tags: [],
    } })
    const savedA = characterA.entities.find((entity) => entity.title === '林月')
    const savedB = characterB.entities.find((entity) => entity.title === '沈砚')
    expect(savedA).toBeDefined()
    expect(savedB).toBeDefined()
    if (!savedA || !savedB) return

    await fallbackInvoke<ProjectData>('upsert_entity', { input: {
      projectPath: projectInput.path, kind: 'relationship', id: null, title: '林月 · 盟友 · 沈砚',
      content: { fromId: savedA.id, toId: savedB.id, label: '盟友', strength: '强', notes: '共同调查雾港停电' }, tags: ['人物关系', '盟友'],
    } })
    const relationships = await fallbackInvoke<EntityRecord[]>('list_entities', { path: projectInput.path, kind: 'relationship' })
    expect(relationships).toHaveLength(1)
    expect(relationships[0]?.content).toMatchObject({ fromId: savedA.id, toId: savedB.id, label: '盟友', strength: '强' })
    expect(created.nodes.some((node) => node.kind === 'chapter')).toBe(true)
  })
})
