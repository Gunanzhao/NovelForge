import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EntityHistoryPanel } from '../src/components/EntityHistoryPanel'
import { projectApi } from '../src/lib/api'
import { entityState } from '../src/lib/entity-history'
import type { EntityRecord, EntityVersion } from '../src/lib/types'
import { useAppStore } from '../src/stores/app-store'

afterEach(() => { cleanup(); vi.restoreAllMocks(); useAppStore.setState(useAppStore.getInitialState(), true) })
async function fixture() {
  const path = 'entity-history-' + crypto.randomUUID()
  await projectApi.create({ path, title: '版本测试', author: '', description: '', genre: '', targetWords: 1000 })
  const input = { projectPath: path, id: 'person', kind: 'character' as const, title: '林月', content: { age: '19', identity: '学徒' }, tags: ['主角'] }
  const first = await projectApi.upsertEntity(input)
  const old = structuredClone(first.entities.find(entity => entity.id === input.id)!)
  const data = await projectApi.upsertEntity({ ...input, content: { age: '23', identity: '医师' } })
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: path, data, activeView: 'character', selectedEntityId: input.id })
  return { path, old, current: data.entities.find(entity => entity.id === input.id)! }
}
function Harness({ path, blocked = false }: { path: string; blocked?: boolean }) {
  const entity = useAppStore(state => state.data!.entities.find(entity => entity.id === 'person')!)
  return <EntityHistoryPanel entity={entity} projectPath={path} blocked={blocked} />
}
it('names a saved version and restores selected fields without replacing other fields', async () => {
  const { path } = await fixture()
  render(<Harness path={path} />)
  fireEvent.click(screen.getByRole('button', { name: '资料版本历史' }))
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
  fireEvent.change(screen.getByLabelText('版本名称'), { target: { value: '第一卷定稿' } })
  fireEvent.click(screen.getByRole('button', { name: '保存命名版本' }))
  await waitFor(() => expect(screen.getByRole('option', { name: /命名版本：第一卷定稿/ })).toBeTruthy())
  const versions = await projectApi.listEntityHistory({ projectPath: path, entityId: 'person' })
  fireEvent.change(screen.getByLabelText('历史版本'), { target: { value: versions.at(-1)!.id } })
  expect(screen.getByLabelText('年龄当前值').textContent).toBe('23')
  expect(screen.getByLabelText('年龄历史值').textContent).toBe('19')
  fireEvent.click(screen.getByRole('checkbox', { name: '年龄' }))
  fireEvent.click(screen.getByRole('button', { name: '恢复所选字段' }))
  await waitFor(() => expect(useAppStore.getState().data!.entities.find(entity => entity.id === 'person')!.content).toEqual({ age: '19', identity: '医师' }))
  const after = await projectApi.listEntityHistory({ projectPath: path, entityId: 'person' })
  expect(after[0].label).toBe('恢复资料版本')
  expect(after.some(version => version.state.content.age === '23')).toBe(true)
})
it('blocks restoration while a draft is unsaved', async () => {
  const { path } = await fixture()
  render(<Harness path={path} blocked />)
  fireEvent.click(screen.getByRole('button', { name: '资料版本历史' }))
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
  const versions = await projectApi.listEntityHistory({ projectPath: path, entityId: 'person' })
  fireEvent.change(screen.getByLabelText('历史版本'), { target: { value: versions.at(-1)!.id } })
  expect((screen.getByRole('button', { name: '恢复整个版本' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('请先保存')
})
it('discards history loaded for a previous entity', async () => {
  const { path, current } = await fixture()
  let resolve!: (versions: EntityVersion[]) => void
  vi.spyOn(projectApi, 'listEntityHistory').mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValueOnce([])
  const view = render(<EntityHistoryPanel entity={current} projectPath={path} />)
  fireEvent.click(screen.getByRole('button', { name: '资料版本历史' }))
  view.rerender(<EntityHistoryPanel entity={{ ...current, id: 'other' }} projectPath={path} />)
  await act(async () => { resolve([{ id: 'late', entityId: current.id, kind: current.kind, label: '旧条目结果', createdAt: current.createdAt, state: entityState(current) }]) })
  expect(screen.queryByRole('option', { name: /旧条目结果/ })).toBeNull()
})
it('guards duplicate restore requests and releases the parent lock after failure', async () => {
  const { path, current } = await fixture()
  const onBusyChange = vi.fn()
  let reject!: (error: Error) => void
  const restore = vi.spyOn(projectApi, 'restoreEntityVersion').mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  render(<EntityHistoryPanel entity={current} projectPath={path} onBusyChange={onBusyChange} />)
  fireEvent.click(screen.getByRole('button', { name: '资料版本历史' }))
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
  const versions = await projectApi.listEntityHistory({ projectPath: path, entityId: 'person' })
  fireEvent.change(screen.getByLabelText('历史版本'), { target: { value: versions.at(-1)!.id } })
  fireEvent.click(screen.getByRole('button', { name: '恢复整个版本' }))
  fireEvent.click(screen.getByRole('button', { name: '恢复整个版本' }))
  expect(restore).toHaveBeenCalledTimes(1)
  expect(onBusyChange).toHaveBeenLastCalledWith(true)
  await act(async () => { reject(new Error('资料已变化')) })
  expect(screen.getByRole('alert').textContent).toContain('资料已变化')
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})
it('fallback rejects stale restores and deduplicates equal objects with different key order', async () => {
  const { path, old, current } = await fixture()
  const versions = await projectApi.listEntityHistory({ projectPath: path, entityId: 'person' })
  await expect(projectApi.restoreEntityVersion({ projectPath: path, entityId: 'person', versionId: versions.at(-1)!.id, expected: entityState(old) })).rejects.toThrow('资料已变化')
  const input = { projectPath: path, id: current.id, kind: current.kind, title: current.title, tags: current.tags, content: { identity: '医师', age: '23' } }
  await projectApi.upsertEntity(input)
  expect(await projectApi.listEntityHistory({ projectPath: path, entityId: 'person' })).toHaveLength(2)
})
it('compares removed custom fields as missing rather than empty strings', async () => {
  const { path, current } = await fixture()
  const historic: EntityVersion = { id: 'old', entityId: current.id, kind: current.kind, label: '移除前', createdAt: current.createdAt, state: { ...entityState(current), content: { ...current.content, 重要设定: '保留内容' } } }
  vi.spyOn(projectApi, 'listEntityHistory').mockResolvedValue([historic])
  render(<EntityHistoryPanel entity={current as EntityRecord} projectPath={path} />)
  fireEvent.click(screen.getByRole('button', { name: '资料版本历史' }))
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
  fireEvent.change(screen.getByLabelText('历史版本'), { target: { value: historic.id } })
  expect(screen.getByLabelText('重要设定当前值').textContent).toBe('（无此字段）')
  expect(screen.getByLabelText('重要设定历史值').textContent).toBe('保留内容')
})
