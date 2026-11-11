import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChapterStageSelect } from '../src/components/ChapterStageSelect'
import { ChapterChecklistInspector } from '../src/components/ChapterWorkflow'
import { projectApi } from '../src/lib/api'
import { chapterStage, checklistForChapter, parseChapterChecklist } from '../src/lib/chapter-workflow'
import { isNodeLocked } from '../src/lib/node-lock'
import { useAppStore } from '../src/stores/app-store'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function setup() {
  const path = 'stage-' + crypto.randomUUID()
  await useAppStore.getState().createProject({ path, title: '阶段联动', author: '', description: '', genre: '', targetWords: 100 })
  return { path, chapter: useAppStore.getState().document!.node }
}

it('preserves legacy review detail and never treats legacy completion as final', async () => {
  const { chapter } = await setup()
  expect(chapterStage({ ...chapter, status: 'done' }, [])).toBe('first-draft-complete')
  expect(chapterStage({ ...chapter, status: 'locked' }, [])).toBe('draft')
  const record = useAppStore.getState().data!.entities.find(item => item.kind === 'chapter-checklist')!
  const old = { ...record, content: { ...record.content, workflowStatus: 'proofread-2' } }
  expect(chapterStage(chapter, [old])).toBe('editing')
  expect(parseChapterChecklist(old).workflowStatus).toBe('proofread-2')
})

it('updates both stage controls and export eligibility without checking off tasks', async () => {
  const { path, chapter } = await setup()
  function Workspace() {
    const data = useAppStore(state => state.data)!
    return <><ChapterStageSelect chapter={chapter} entities={data.entities} /><ChapterChecklistInspector /></>
  }
  render(<Workspace />)
  fireEvent.change(screen.getByLabelText('写作阶段'), { target: { value: 'final' } })
  await waitFor(() => expect((screen.getByLabelText('章节完成中的写作阶段') as HTMLSelectElement).value).toBe('final'))
  expect(checklistForChapter(useAppStore.getState().data!.entities, chapter.id)?.items.every(item => !item.completed)).toBe(true)
  const final = await projectApi.exportPreflight({ projectPath: path, scope: 'project', onlyFinal: true })
  expect(final.chapters).toBe(1)
  expect(final.excludedChapters).toBe(0)
  fireEvent.change(screen.getByLabelText('章节完成中的写作阶段'), { target: { value: 'editing' } })
  await waitFor(() => expect((screen.getByLabelText('写作阶段') as HTMLSelectElement).value).toBe('editing'))
  const revised = await projectApi.exportPreflight({ projectPath: path, scope: 'project', onlyFinal: true })
  expect(revised.chapters).toBe(0)
  expect(revised.excludedChapters).toBe(1)
})

it('serializes stage and checklist writes so neither overwrites the other', async () => {
  const { chapter } = await setup()
  await Promise.all([
    useAppStore.getState().setChapterStage(chapter.id, 'final'),
    useAppStore.getState().updateChapterChecklist(chapter.id, value => ({ ...value, items: value.items.map(item => ({ ...item, completed: true })) })),
  ])
  const saved = checklistForChapter(useAppStore.getState().data!.entities, chapter.id)!
  expect(saved.workflowStatus).toBe('final')
  expect(saved.items.every(item => item.completed)).toBe(true)
})

it('keeps a final stage across lock, unlock and reopening', async () => {
  const { path, chapter } = await setup()
  await useAppStore.getState().setChapterStage(chapter.id, 'final')
  await useAppStore.getState().setNodeStatus(chapter.id, 'locked')
  expect(isNodeLocked(useAppStore.getState().data!.nodes, chapter.id)).toBe(true)
  expect(chapterStage(useAppStore.getState().document!.node, useAppStore.getState().data!.entities)).toBe('final')
  await useAppStore.getState().setNodeStatus(chapter.id, 'draft')
  await useAppStore.getState().openProject(path)
  expect(chapterStage(useAppStore.getState().document!.node, useAppStore.getState().data!.entities)).toBe('final')
  expect(isNodeLocked(useAppStore.getState().data!.nodes, chapter.id)).toBe(false)
})

it('retains the persisted stage on a rejected write and permits retry', async () => {
  const { chapter } = await setup()
  const save = vi.spyOn(projectApi, 'upsertEntity').mockRejectedValueOnce(new Error('保存失败'))
  await act(async () => { await expect(useAppStore.getState().setChapterStage(chapter.id, 'final')).rejects.toThrow('保存失败') })
  expect(chapterStage(chapter, useAppStore.getState().data!.entities)).toBe('draft')
  expect(save.mock.calls[0][1]).toBeDefined()
  await useAppStore.getState().setChapterStage(chapter.id, 'final')
  expect(chapterStage(chapter, useAppStore.getState().data!.entities)).toBe('final')
})
