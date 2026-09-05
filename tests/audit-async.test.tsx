import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentData, EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

const api = vi.hoisted(() => ({ upsertEntity: vi.fn(), getDocument: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: false, projectApi: api }))

import { MentionInspector } from '../src/components/MentionInspector'
import { CharacterAppearancePanel } from '../src/components/CharacterAppearance'
import { clearProjectMentionIndex } from '../src/lib/character-appearance'
import { useAppStore } from '../src/stores/app-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const chapter: NodeRecord = {
  id: 'chapter-a', kind: 'chapter', parentId: null, title: '第一章', orderIndex: 0,
  status: 'draft', filePath: 'a.md', createdAt: '', updatedAt: '',
}
const otherChapter: NodeRecord = { ...chapter, id: 'chapter-b', title: '第二章', filePath: 'b.md', orderIndex: 1 }
const character: EntityRecord = {
  id: 'suqing', kind: 'character', title: '苏晴', tags: [], content: {},
  filePath: 'suqing.md', createdAt: '', updatedAt: '',
}
const project: ProjectData = {
  project: {
    formatVersion: 1, id: 'project-a', title: '测试', author: '', description: '', genre: '',
    targetWords: 1000, createdAt: '', updatedAt: '',
  },
  nodes: [chapter, otherChapter], entities: [], recovery: [],
}
const original = '苏晴推开门。'

beforeEach(() => {
  vi.resetAllMocks()
  clearProjectMentionIndex()
  useAppStore.setState({
    ...useAppStore.getInitialState(), projectPath: 'project-a', data: project,
    document: { node: chapter, content: original },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('mention creation while saving', () => {
  async function startInsert() {
    vi.useFakeTimers()
    const saving = deferred<ProjectData>()
    api.upsertEntity.mockReturnValueOnce(saving.promise)
    render(<MentionInspector />)
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    fireEvent.click(screen.getByRole('button', { name: '创建并插入 Wiki' }))
    expect(api.upsertEntity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      projectPath: 'project-a', kind: 'character', title: '苏晴',
      content: { firstAppearance: chapter.id, firstAppearanceTitle: chapter.title },
    }))
    return async () => {
      await act(async () => { saving.resolve({ ...project, entities: [character] }); await saving.promise })
    }
  }

  it('inserts Wiki into the latest content and preserves input made during the pending save', async () => {
    const finish = await startInsert()
    act(() => useAppStore.getState().updateContent(`${original}保存期间继续输入。`))
    await finish()
    expect(useAppStore.getState().document?.content).toBe('[[苏晴]]推开门。保存期间继续输入。')
    expect(useAppStore.getState().saveState).toBe('idle')
    expect(useAppStore.getState().data?.entities).toEqual([character])
  })

  it('preserves replacement text when the scanned name was edited during saving', async () => {
    const finish = await startInsert()
    act(() => useAppStore.getState().updateContent('她推开门。新的内容。'))
    await finish()
    expect(useAppStore.getState().document?.content).toBe('她推开门。新的内容。')
  })

  it.each(['chapter', 'project'] as const)('does not insert into a different %s after saving', async (destination) => {
    const finish = await startInsert()
    // The destination deliberately has the same name at the same offset;
    // text-range validation alone must not authorize an insertion here.
    const node = destination === 'chapter' ? otherChapter : chapter
    act(() => useAppStore.setState({
      projectPath: destination === 'project' ? 'project-b' : 'project-a',
      document: { node, content: '苏晴正在另一处。' }, saveState: 'saved',
    }))
    await finish()
    expect(useAppStore.getState().document).toEqual({ node, content: '苏晴正在另一处。' })
    expect(useAppStore.getState().saveState).toBe('saved')
  })
})

describe('character appearance scan races through the panel', () => {
  function startScans() {
    const old = deferred<DocumentData>()
    const latest = deferred<DocumentData>()
    api.getDocument.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const data = { ...project, nodes: [chapter], entities: [character] }
    useAppStore.setState({ data })
    render(<CharacterAppearancePanel characterId={character.id} />)
    act(() => useAppStore.setState({ projectPath: 'project-b', data: { ...data, project: { ...data.project, id: 'project-b' } } }))
    expect(api.getDocument.mock.calls).toEqual([
      [{ projectPath: 'project-a', nodeId: chapter.id }],
      [{ projectPath: 'project-b', nodeId: chapter.id }],
    ])
    return { old, latest }
  }

  it('does not let an older scan overwrite the latest visible counts', async () => {
    const { old, latest } = startScans()
    await act(async () => { latest.resolve({ node: chapter, content: '苏晴。苏晴。' }); await latest.promise })
    expect(screen.getByRole('button', { name: '第一章 2 次' })).toBeTruthy()
    await act(async () => { old.resolve({ node: chapter, content: '苏晴。' }); await old.promise })
    expect(screen.getByRole('button', { name: '第一章 2 次' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '第一章 1 次' })).toBeNull()
  })

  it.each(['resolve', 'reject'] as const)('keeps loading the latest scan when the old scan settles by %s', async (outcome) => {
    const { old, latest } = startScans()
    await act(async () => {
      if (outcome === 'resolve') old.resolve({ node: chapter, content: '苏晴。' })
      else old.reject(new Error('旧项目读取失败'))
      await old.promise.catch(() => undefined)
    })
    expect(screen.getByText('扫描中…')).toBeTruthy()
    expect((screen.getByRole('button', { name: '重新扫描全文' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '第一章 1 次' })).toBeNull()
    expect(useAppStore.getState().error).toBeNull()
    await act(async () => { latest.resolve({ node: chapter, content: '苏晴。苏晴。' }); await latest.promise })
    expect(screen.getByRole('button', { name: '第一章 2 次' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '重新扫描全文' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
