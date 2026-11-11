import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Dashboard } from '../src/components/Dashboard'
import { readEditorSession, rememberEditor, resumeWritingNode } from '../src/lib/editor-session'
import { useAppStore } from '../src/stores/app-store'

async function setup() {
  const path = 'resume-' + crypto.randomUUID()
  await useAppStore.getState().createProject({ path, title: '恢复写作测试', author: '', description: '', genre: '', targetWords: 100 })
  const first = useAppStore.getState().document!.node
  await useAppStore.getState().createNode('chapter', '最近修改的章节', first.parentId)
  const recent = useAppStore.getState().data!.nodes.find(node => node.title === '最近修改的章节')!
  await useAppStore.getState().selectNode(recent.id)
  await useAppStore.getState().selectNode(first.id)
  useAppStore.getState().setView('dashboard')
  return { path, first, recent }
}

it('continues the last opened chapter instead of the most recently modified one', async () => {
  const { first, recent } = await setup()
  const data = useAppStore.getState().data!
  useAppStore.setState({ data: { ...data, nodes: data.nodes.map(node => ({ ...node, updatedAt: node.id === recent.id ? '2030-01-01' : '2020-01-01' })) } })
  render(<Dashboard />)
  expect(screen.getByRole('button', { name: '继续写作' }).title).toBe(first.title)
  fireEvent.click(screen.getByRole('button', { name: '继续写作' }))
  await waitFor(() => expect(useAppStore.getState().activeView).toBe('manuscript'))
  expect(useAppStore.getState().document?.node.id).toBe(first.id)
})

it('resumes the same section from dashboard and project reopening while keeping its caret and scroll position', async () => {
  const { path, first } = await setup()
  await useAppStore.getState().createNode('section', '港口小节', first.id)
  const section = useAppStore.getState().data!.nodes.find(node => node.title === '港口小节')!
  await useAppStore.getState().selectNode(section.id)
  const position = { anchor: 3, head: 8, scrollTop: 120, scrollLeft: 0 }
  rememberEditor(path, section.id, position)
  useAppStore.getState().setView('dashboard')
  render(<Dashboard />)
  expect(screen.getByRole('button', { name: '继续写作' }).title).toBe(first.title + ' / 港口小节')
  fireEvent.click(screen.getByRole('button', { name: '继续写作' }))
  await waitFor(() => expect(useAppStore.getState().activeView).toBe('manuscript'))
  expect(useAppStore.getState().document?.node.id).toBe(section.id)
  await act(async () => { await useAppStore.getState().closeProject(); await useAppStore.getState().openProject(path) })
  expect(useAppStore.getState().document?.node.id).toBe(section.id)
  expect(readEditorSession(path).positions[section.id]).toEqual(position)
})

it('falls back to manuscript order for missing or volume IDs and disables continuing an empty project', async () => {
  const { path, first } = await setup()
  const data = useAppStore.getState().data!
  expect(resumeWritingNode(data.nodes, 'deleted')?.id).toBe(first.id)
  expect(resumeWritingNode(data.nodes, first.parentId!)?.id).toBe(first.id)
  rememberEditor(path, 'deleted')
  await useAppStore.getState().openProject(path)
  expect(useAppStore.getState().document?.node.id).toBe(first.id)
  useAppStore.setState({ data: { ...data, nodes: data.nodes.filter(node => node.kind === 'volume') }, document: null })
  render(<Dashboard />)
  expect((screen.getByRole('button', { name: '继续写作' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('先从左侧创建章节')).toBeTruthy()
})
