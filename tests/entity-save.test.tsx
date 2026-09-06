import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { EntityInput, ProjectData } from '../src/lib/types'
const api = vi.hoisted(() => ({ upsertEntity: vi.fn(), search: vi.fn(async () => []), getDocument: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: false, projectApi: api }))
vi.mock('../src/components/ContextMenu', () => ({ useContextMenu: () => ({ openContextMenu: vi.fn() }) }))
vi.mock('../src/components/CharacterAppearance', () => ({ CharacterAppearancePanel: () => null }))
import { EntityView } from '../src/components/EntityView'
import { useAppStore } from '../src/stores/app-store'
const project: ProjectData = { project: { formatVersion: 1, id: 'p', title: 'P', author: '', description: '', genre: '', targetWords: 0, createdAt: '', updatedAt: '' }, nodes: [], entities: [], recovery: [] }
beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ ...useAppStore.getInitialState(), data: project, projectPath: 'P', selectedEntityId: null })
  api.upsertEntity.mockImplementation(async (input: EntityInput) => ({ ...project, entities: [{ ...input, filePath: 'entity.md', createdAt: '', updatedAt: '' }] }))
})
it('selects the saved entity and reuses its ID on subsequent saves', async () => {
  render(<EntityView kind="character" />)
  fireEvent.change(screen.getByPlaceholderText('输入人物名称'), { target: { value: '测试人物' } })
  fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
  await waitFor(() => expect(useAppStore.getState().selectedEntityId).toBeTruthy())
  const id = useAppStore.getState().selectedEntityId
  fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
  await waitFor(() => expect(api.upsertEntity).toHaveBeenCalledTimes(2))
  expect(api.upsertEntity.mock.calls.map(call => call[0].id)).toEqual([id, id])
  expect(useAppStore.getState().data?.entities).toHaveLength(1)
})
it('ignores a save completion after switching projects', async () => {
  let resolve!: (data: ProjectData) => void
  api.upsertEntity.mockImplementationOnce(() => new Promise<ProjectData>(yes => { resolve = yes }))
  render(<EntityView kind="character" />)
  fireEvent.change(screen.getByPlaceholderText('输入人物名称'), { target: { value: '旧人物' } })
  fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
  const next = { ...project, project: { ...project.project, id: 'q' } }
  await act(async () => { useAppStore.setState({ projectPath: 'Q', data: next, selectedEntityId: 'new-selection' }); resolve(project) })
  expect(useAppStore.getState().selectedEntityId).toBe('new-selection')
  expect(useAppStore.getState().data).toBe(next)
})
