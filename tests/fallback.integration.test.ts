import { describe, expect, it } from 'vitest'
import { exportText, fallbackInvoke } from '../src/lib/fallback'
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

    const chapterContent = '# 第一章' + '\n\n' + '林月走进雾港。'
    const saved = await fallbackInvoke<DocumentData>('save_document', {
      input: { projectPath: input.path, nodeId: chapter.id, content: chapterContent, reason: '测试保存' },
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
    const stored = JSON.parse(localStorage.getItem('novelforge-fallback:' + encodeURIComponent(input.path)) ?? '{}')
    const chapterExport = exportText(stored, 'markdown', { projectPath: input.path, format: 'markdown', scope: 'chapters', nodeIds: [chapter.id] })
    expect(chapterExport).toContain('第一章')
    expect(chapterExport).toContain('林月走进雾港')
    for (const format of ['txt', 'html'] as const) {
      const path = await fallbackInvoke<string>('export_project', { input: { projectPath: input.path, format } })
      expect(path.endsWith('.' + format)).toBe(true)
    }
    for (const format of ['docx', 'epub', 'pdf'] as const) {
      await expect(fallbackInvoke<string>('export_project', { input: { projectPath: input.path, format } })).rejects.toThrow('请使用桌面版导出')
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
    const restored = await fallbackInvoke<ProjectData>('restore_trash', { input: { projectPath: 'trash-test-project', nodeId: trash[0].id } })
    expect(restored.nodes.some((node) => node.id === chapter.id)).toBe(true)
    expect(await fallbackInvoke<TrashItem[]>('list_trash', { path: 'trash-test-project' })).toHaveLength(0)
  })

  it('keeps nested markdown paths and restores recursive node and entity snapshots', async () => {
    const path = 'nested-trash-test-project'
    const created = await fallbackInvoke<ProjectData>('create_project', { input: { ...input, path } })
    const volume = created.nodes.find((node) => node.kind === 'volume')
    const chapter = created.nodes.find((node) => node.kind === 'chapter')
    expect(volume && chapter).toBeTruthy()
    if (!volume || !chapter) return
    const extraChapterData = await fallbackInvoke<ProjectData>('create_node', { input: { projectPath: path, kind: 'chapter', title: '第二章', parentId: volume.id } })
    const extraChapter = extraChapterData.nodes.find((node) => node.title === '第二章')
    expect(extraChapter?.filePath).toBe('manuscript/volume_001/chapter_002.md')
    if (!extraChapter) return
    const sectionData = await fallbackInvoke<ProjectData>('create_node', { input: { projectPath: path, kind: 'section', title: '第二章·节', parentId: extraChapter.id } })
    const section = sectionData.nodes.find((node) => node.title === '第二章·节')
    expect(section?.filePath).toBe('manuscript/volume_001/chapter_002/section_001.md')
    if (!section) return
    await fallbackInvoke<EntityRecord>('upsert_entity', {
      input: { projectPath: path, kind: 'character', id: null, title: '林月', content: { role: '主角' }, tags: ['主角'] },
    })
    const beforeDelete = await fallbackInvoke<ProjectData>('delete_node', { input: { projectPath: path, nodeId: volume.id } })
    expect(beforeDelete.nodes).toHaveLength(0)
    const trash = await fallbackInvoke<TrashItem[]>('list_trash', { path })
    expect(trash).toHaveLength(1)
    const afterRestore = await fallbackInvoke<ProjectData>('restore_trash', { input: { projectPath: path, nodeId: trash[0].id } })
    expect(afterRestore.nodes.filter((node) => node.kind !== 'volume')).toHaveLength(3)
    expect(afterRestore.nodes.find((node) => node.id === section.id)?.filePath).toBe(section.filePath)
    expect(afterRestore.entities.some((entity) => entity.title === '林月')).toBe(true)
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

  it('matches desktop validation for duplicate projects and invalid mutations', async () => {
    const path = 'fallback-validation-project'
    await fallbackInvoke<ProjectData>('create_project', { input: { ...input, path } })
    await expect(fallbackInvoke<ProjectData>('create_project', { input: { ...input, path } })).rejects.toThrow('已经存在')
    await expect(fallbackInvoke<ProjectData>('create_node', { input: { projectPath: path, kind: 'chapter', title: '', parentId: null } })).rejects.toThrow('标题不能为空')
    const project = await fallbackInvoke<ProjectData>('open_project', { path })
    const chapter = project.nodes.find((node) => node.kind === 'chapter')
    expect(chapter).toBeDefined()
    if (!chapter) return
    await expect(fallbackInvoke<ProjectData>('set_node_status', { input: { projectPath: path, nodeId: chapter.id, status: 'invalid' } })).rejects.toThrow('状态无效')
    await expect(fallbackInvoke<ProjectData>('delete_node', { input: { projectPath: path, nodeId: 'missing-node' } })).rejects.toThrow('节点不存在')
    await expect(fallbackInvoke<ProjectData>('delete_entity', { input: { projectPath: path, nodeId: 'missing-entity' } })).rejects.toThrow('资料条目不存在')
  })

  it('keeps markdown titles and history aligned with desktop editing rules', async () => {
    const path = 'fallback-document-boundaries-project'
    const created = await fallbackInvoke<ProjectData>('create_project', { input: { ...input, path } })
    const chapter = created.nodes.find((node) => node.kind === 'chapter')
    const volume = created.nodes.find((node) => node.kind === 'volume')
    expect(chapter && volume).toBeTruthy()
    if (!chapter || !volume) return
    await fallbackInvoke<DocumentData>('save_document', {
      input: { projectPath: path, nodeId: chapter.id, content: '# 第一章\n\n第一版正文', reason: '第一版' },
    })
    await fallbackInvoke<DocumentData>('save_document', {
      input: { projectPath: path, nodeId: chapter.id, content: '# 第一章\n\n第二版正文', reason: '第二版' },
    })
    await fallbackInvoke<ProjectData>('rename_node', { input: { projectPath: path, nodeId: chapter.id, title: '重命名章节' } })
    const renamed = await fallbackInvoke<DocumentData>('get_document', { input: { projectPath: path, nodeId: chapter.id } })
    expect(renamed.content).toContain('# 重命名章节')
    const history = await fallbackInvoke<{ id: string }[]>('list_history', { input: { projectPath: path, nodeId: chapter.id } })
    await fallbackInvoke<ProjectData>('restore_history', { input: { projectPath: path, revisionId: history[history.length - 1].id } })
    const restored = await fallbackInvoke<DocumentData>('get_document', { input: { projectPath: path, nodeId: chapter.id } })
    expect(restored.content).toContain('第一版正文')
    await expect(fallbackInvoke<DocumentData>('get_document', { input: { projectPath: path, nodeId: volume.id } })).rejects.toThrow('卷没有正文文件')
    await expect(fallbackInvoke<DocumentData>('save_document', { input: { projectPath: path, nodeId: volume.id, content: '非法', reason: '测试' } })).rejects.toThrow('只有未删除的章节或小节可以编辑')
  })
})
