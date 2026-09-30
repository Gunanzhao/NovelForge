import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { useAppStore } from '../src/stores/app-store'
import App from '../src/App'
import fixture from './fixtures/reliability-contract.json'

beforeEach(() => { vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); localStorage.clear(); useAppStore.setState(useAppStore.getInitialState(), true) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it.each(['null', '{}', '"bad"', '[null]', '{invalid'])('malformed recent cache %s still renders welcome and remembers a new project', async raw => {
  localStorage.setItem('novelforge:recent-projects', raw)
  localStorage.setItem('novelforge:theme', 'dark')
  localStorage.setItem('private-draft', 'keep')
  const view = render(<App />)
  expect(screen.getByText('从一部小说开始')).toBeTruthy()
  expect(useAppStore.getState().recentProjects).toEqual([])
  view.unmount()
  await act(async () => { await useAppStore.getState().createProject({ ...fixture.project, path: 'recent-' + crypto.randomUUID() }) })
  expect(useAppStore.getState().recentProjects[0].title).toBe(fixture.project.title)
  expect(localStorage.getItem('private-draft')).toBe('keep')
  expect(localStorage.getItem('novelforge:theme')).toBe('dark')
})
it('filters fields, duplicate paths and excessive entries through the load/display chain', () => {
  const valid = { path: 'p', title: '可显示项目', updatedAt: '2026-09-30T00:00:00Z' }
  localStorage.setItem('novelforge:recent-projects', JSON.stringify([null, {}, { ...valid, title: 2 }, { ...valid, updatedAt: 'bad' }, valid, valid, ...Array.from({ length: 20 }, (_, i) => ({ ...valid, path: 'p' + i, title: '项目' + i }))]))
  const view = render(<App />)
  expect(useAppStore.getState().recentProjects).toHaveLength(8)
  expect(screen.getAllByText('可显示项目')).toHaveLength(1)
  view.unmount()
})
it('render failure retains current body, rescue download and a copyable textarea without refresh', async () => {
  await useAppStore.getState().createProject({ ...fixture.project, path: 'boundary-' + crypto.randomUUID() })
  useAppStore.getState().updateContent(fixture.body)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  function Broken(): never { throw new Error('synthetic render failure') }
  render(<ErrorBoundary><Broken /></ErrorBoundary>)
  expect((screen.getByLabelText('救援正文') as HTMLTextAreaElement).value).toBe(fixture.body)
  expect(useAppStore.getState().document?.content).toBe(fixture.body)
  expect(screen.getByRole('button', { name: '下载救援稿' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '重新显示' }))
  expect(useAppStore.getState().document?.content).toBe(fixture.body)
})
