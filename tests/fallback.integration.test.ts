import { describe, expect, it } from 'vitest'
import { fallbackInvoke } from '../src/lib/fallback'
import type { ConsistencyReport, DocumentData, EntityRecord, ProjectData, ProjectInput, SearchResult, Stats, TrashItem } from '../src/lib/types'

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
    expect(stats.daily).toHaveLength(30)
    expect(stats.chapterStats).toHaveLength(1)
    const consistency = await fallbackInvoke<ConsistencyReport>('check_consistency', { path: input.path })
    expect(consistency.issueCount).toBe(0)
    const exportPath = await fallbackInvoke<string>('export_project', { input: { projectPath: input.path, format: 'markdown' } })
    expect(exportPath).toContain('browser://exports')
    for (const format of ['txt', 'html', 'docx', 'epub', 'pdf'] as const) {
      const path = await fallbackInvoke<string>('export_project', { input: { projectPath: input.path, format } })
      expect(path.endsWith('.' + format)).toBe(true)
    }
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

  it('supports current-document, volume and tag search filters', async () => {
    const path = 'search-filter-project'
    const created = await fallbackInvoke<ProjectData>('create_project', { input: { ...input, path } })
    const chapter = created.nodes.find((node) => node.kind === 'chapter')
    const volume = created.nodes.find((node) => node.kind === 'volume')
    expect(chapter && volume).toBeTruthy()
    if (!chapter || !volume) return
    await fallbackInvoke<DocumentData>('save_document', { input: { projectPath: path, nodeId: chapter.id, content: '林月在雾港写下秘密。', reason: '筛选测试' } })
    await fallbackInvoke<ProjectData>('upsert_entity', { input: { projectPath: path, kind: 'character', id: null, title: '林月', content: { summary: '主角' }, tags: ['主角'] } })
    const current = await fallbackInvoke<SearchResult[]>('search_project', { input: { projectPath: path, query: '雾港', scope: 'current', nodeId: chapter.id } })
    expect(current.map((item) => item.id)).toEqual([chapter.id])
    const tagged = await fallbackInvoke<SearchResult[]>('search_project', { input: { projectPath: path, query: '林月', tag: '主角' } })
    expect(tagged.some((item) => item.title === '林月')).toBe(true)
    const volumeResults = await fallbackInvoke<SearchResult[]>('search_project', { input: { projectPath: path, query: '秘密', volumePath: volume.filePath } })
    expect(volumeResults.some((item) => item.id === chapter.id)).toBe(true)
  })

  it('moves and copies a chapter in the browser fallback tree', async () => {
    const path = 'move-copy-fallback-project'
    const created = await fallbackInvoke<ProjectData>('create_project', { input: { ...input, path } })
    const firstVolume = created.nodes.find((node) => node.kind === 'volume')
    const firstChapter = created.nodes.find((node) => node.kind === 'chapter')
    expect(firstVolume && firstChapter).toBeTruthy()
    if (!firstVolume || !firstChapter) return
    const secondVolumeData = await fallbackInvoke<ProjectData>('create_node', { input: { projectPath: path, kind: 'volume', title: '第二卷', parentId: null } })
    const secondVolume = secondVolumeData.nodes.find((node) => node.title === '第二卷')
    expect(secondVolume).toBeDefined()
    if (!secondVolume) return
    const moved = await fallbackInvoke<ProjectData>('move_node', { input: { projectPath: path, nodeId: firstChapter.id, targetParentId: secondVolume.id } })
    expect(moved.nodes.find((node) => node.id === firstChapter.id)?.parentId).toBe(secondVolume.id)
    const copied = await fallbackInvoke<ProjectData>('copy_node', { input: { projectPath: path, nodeId: firstChapter.id, targetParentId: firstVolume.id, title: '第一章副本' } })
    expect(copied.nodes.some((node) => node.title === '第一章副本')).toBe(true)
  })
})
