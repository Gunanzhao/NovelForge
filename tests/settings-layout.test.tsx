import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProjectData } from '../src/lib/types'
const api = vi.hoisted(() => ({ updateProject: vi.fn(), readLogs: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: api }))
import { SettingsView } from '../src/components/SettingsView'
import { useAppStore } from '../src/stores/app-store'
import { DEFAULT_WORKSPACE_PREFERENCES } from '../src/lib/workspace-preferences'
const data: ProjectData = { project: { id: 'p', title: '旧作品', author: '', description: '', genre: '', targetWords: 1000, formatVersion: 1, createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z' }, nodes: [], entities: [], recovery: [] }
beforeEach(() => { vi.clearAllMocks(); api.readLogs.mockResolvedValue('操作记录'); localStorage.clear(); useAppStore.setState({ data, projectPath: 'project', document: null, workspacePreferences: { ...DEFAULT_WORKSPACE_PREFERENCES }, theme: 'system', error: null, preferenceError: null }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp('^' + name) }))
it('retains project and checklist drafts across categories and unrelated data refreshes', () => {
  render(<SettingsView />)
  fireEvent.change(screen.getByLabelText('作品名'), { target: { value: '未保存作品' } })
  tab('写作目标')
  fireEvent.change(screen.getByLabelText(/^检查项/), { target: { value: '未保存检查项' } })
  act(() => useAppStore.setState({ data: { ...data, entities: [...data.entities] } }))
  tab('作品信息')
  expect((screen.getByLabelText('作品名') as HTMLInputElement).value).toBe('未保存作品')
  expect(screen.getByText('作品信息有未保存修改')).toBeTruthy()
  tab('写作目标')
  expect((screen.getByLabelText(/^检查项/) as HTMLTextAreaElement).value).toBe('未保存检查项')
})
it('preserves inputs on save failure and allows a successful retry', async () => {
  api.updateProject.mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValueOnce({ ...data, project: { ...data.project, title: '新作品' } })
  render(<SettingsView />)
  fireEvent.change(screen.getByLabelText('作品名'), { target: { value: '新作品' } })
  fireEvent.click(screen.getByRole('button', { name: '保存作品信息' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('磁盘不可写'))
  expect((screen.getByLabelText('作品名') as HTMLInputElement).value).toBe('新作品')
  fireEvent.click(screen.getByRole('button', { name: '保存作品信息' }))
  await waitFor(() => expect(screen.getByText('作品信息已保存')).toBeTruthy())
  expect(api.updateProject).toHaveBeenLastCalledWith(expect.objectContaining({ projectPath: 'project', title: '新作品', targetWords: 1000 }))
})
it('resets only editor preferences and accepts exact numeric input', () => {
  useAppStore.setState({ workspacePreferences: { ...DEFAULT_WORKSPACE_PREFERENCES, dailyTargetWords: 2300, sidebarWidth: 300 } })
  render(<SettingsView />); tab('编辑器')
  fireEvent.change(screen.getByLabelText('编辑字号数值'), { target: { value: '18' } }); fireEvent.blur(screen.getByLabelText('编辑字号数值'))
  expect(useAppStore.getState().workspacePreferences.editorFontSize).toBe(18)
  fireEvent.click(screen.getByRole('button', { name: '恢复本页默认' }))
  expect(useAppStore.getState().workspacePreferences).toMatchObject({ editorFontSize: 14, dailyTargetWords: 2300, sidebarWidth: 300 })
})
it('loads logs only on expansion and refreshes on request', async () => {
  const { container } = render(<SettingsView />)
  expect(api.readLogs).not.toHaveBeenCalled(); tab('数据与日志'); expect(api.readLogs).not.toHaveBeenCalled()
  const details = container.querySelector('.settings-logs') as HTMLDetailsElement
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')) })
  await waitFor(() => expect(screen.getByText('操作记录')).toBeTruthy())
  expect(api.readLogs).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '刷新日志' }))
  await waitFor(() => expect(api.readLogs).toHaveBeenCalledTimes(2))
})
it('resets the form when switching projects', () => {
  render(<SettingsView />)
  fireEvent.change(screen.getByLabelText('作品名'), { target: { value: '前一个项目的草稿' } })
  act(() => useAppStore.setState({ projectPath: 'other', data: { ...data, project: { ...data.project, id: 'other', title: '另一个项目' } } }))
  expect((screen.getByLabelText('作品名') as HTMLInputElement).value).toBe('另一个项目')
})
it('reports preference write failure and retries without losing the live value', () => {
  const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  render(<SettingsView />); tab('编辑器')
  fireEvent.change(screen.getByLabelText('编辑字号'), { target: { value: '18' } })
  expect(screen.getByRole('alert').textContent).toContain('偏好未保存')
  expect(useAppStore.getState().workspacePreferences.editorFontSize).toBe(18)
  failing.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: '重试保存偏好' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(JSON.parse(localStorage.getItem('novelforge:workspace-preferences:v1')!).editorFontSize).toBe(18)
})

it('normalizes a fractional integer input even when the persisted value is unchanged', () => {
  render(<SettingsView />); tab('编辑器')
  const input = screen.getByLabelText('编辑字号数值') as HTMLInputElement
  fireEvent.change(input, { target: { value: '14.4' } }); fireEvent.blur(input)
  expect(input.value).toBe('14')
  expect(useAppStore.getState().workspacePreferences.editorFontSize).toBe(14)
})