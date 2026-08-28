import { describe, expect, it } from 'vitest'
import { fallbackInvoke } from '../src/lib/fallback'
import type { DocumentData, EntityRecord, ProjectData, ProjectInput, SearchResult, Stats, TrashItem } from '../src/lib/types'

const input: ProjectInput = {
  path: 'browser-test-project',
  title: '雾港来信',
  author: '测试作者',
  description: '一个测试项目',
  genre: '现代',
  targetWords: 10000,
}

describe('browser fallback project workflow', () => {
  it('creates, saves, searches, exports and manages an entity', async () => {
    const created = await fallbackInvoke<ProjectData>('create_project', { input })
    expect(created.project.formatVersion).toBe(1)
    const chapter = created.nodes.find((node) => node.kind === 'chapter')
    expect(chapter).toBeDefined()
    if (!chapter) return

    const saved = await fallbackInvoke<DocumentData>('save_document', {
      input: { projectPath: input.path, nodeId: chapter.id, content: '# 第一章\\n\\n林月走进雾港。', reason: '测试保存' },
    })
    expect(saved.content).toContain('雾港')

    await fallbackInvoke<ProjectData>('upsert_entity', {
      input: { projectPath: input.path, kind: 'character', id: null, title: '林月', content: { status: '活动' }, tags: ['主角'] },
    })
    const entities = await fallbackInvoke<EntityRecord[]>('list_entities', { path: input.path, kind: 'character' })
    expect(entities[0]?.title).toBe('林月')

    const results = await fallbackInvoke<SearchResult[]>('search_project', {
      input: { projectPath: input.path, query: '雾港', kind: undefined },
    })
    expect(results.some((result) => result.id === chapter.id)).toBe(true)

    const stats = await fallbackInvoke<Stats>('get_statistics', { path: input.path })
    expect(stats.totalWords).toBeGreaterThan(0)
    const exportPath = await fallbackInvoke<string>('export_project', { input: { projectPath: input.path, format: 'markdown' } })
    expect(exportPath).toContain('browser://exports')
  })

  it('moves deleted content to recoverable trash', async () => {
    const created = await fallbackInvoke<ProjectData>('create_project', { input: { ...input, path: 'trash-test-project' } })
    const chapter = created.nodes.find((node) => node.kind === 'chapter')
    expect(chapter).toBeDefined()
    if (!chapter) return
    await fallbackInvoke<ProjectData>('delete_node', { input: { projectPath: 'trash-test-project', nodeId: chapter.id } })
    const trash = await fallbackInvoke<TrashItem[]>('list_trash', { path: 'trash-test-project' })
    expect(trash).toHaveLength(1)
    expect(trash[0].refId).toBe(chapter.id)
  })
})
