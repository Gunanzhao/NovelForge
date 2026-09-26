import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ManuscriptImportView } from '../src/components/ManuscriptImportView'
import { projectApi } from '../src/lib/api'
import { useAppStore } from '../src/stores/app-store'
import { dirtyDrafts } from '../src/lib/draft-guard'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function fixture() {
  const path = 'import-view-' + crypto.randomUUID()
  const data = await projectApi.create({ path, title: '导入测试', author: '', description: '', genre: '', targetWords: 1 })
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: path, data, activeView: 'manuscript-import' })
  return { path, data, parentId: data.nodes.find(node => node.kind === 'volume')!.id }
}
function file(text: string, name = '原稿.md') {
  const value = new TextEncoder().encode(text)
  const result = new File([value], name, { type: 'text/plain' })
  Object.defineProperty(result, 'arrayBuffer', { value: async () => value.buffer })
  return result
}
async function preview(text = '# 新章甲\n明月升起\n# 新章乙\n旅程开始') {
  fireEvent.change(screen.getByLabelText(/^原稿文件/u), { target: { files: [file(text)] } })
  fireEvent.click(await screen.findByRole('button', { name: '生成分章预览' }))
  await screen.findByLabelText('导入章节名称')
}
function confirm() { fireEvent.click(screen.getByLabelText('我已核对编码、分章、内容和目标卷，确认创建这些章节。')); fireEvent.click(screen.getByRole('button', { name: '确认导入' })) }

it('previews and edits chapters before explicit atomic creation', async () => {
  const { path, data } = await fixture(); render(<ManuscriptImportView />)
  await preview()
  expect((await projectApi.open(path)).nodes).toHaveLength(data.nodes.length)
  expect(dirtyDrafts().some(draft => draft.label === '稿件导入预览')).toBe(true)
  expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('导入章节名称'), { target: { value: '修改后的标题' } })
  fireEvent.change(screen.getByLabelText('导入章节正文'), { target: { value: '作者核对后的正文' } })
  confirm()
  await screen.findByText(/已导入2个章节/)
  const saved = await projectApi.open(path)
  const imported = saved.nodes.find(node => node.title === '修改后的标题')!
  expect((await projectApi.getDocument({ projectPath: path, nodeId: imported.id })).content).toBe('作者核对后的正文')
  expect(saved.nodes).toHaveLength(data.nodes.length + 2)
  expect(dirtyDrafts()).toHaveLength(0)
})
it('retains the preview and original project on a name collision', async () => {
  const { path, data } = await fixture(); render(<ManuscriptImportView />)
  await preview('# 第一章\n原项目不应覆盖')
  confirm(); await screen.findByRole('alert')
  expect((await projectApi.open(path)).nodes).toHaveLength(data.nodes.length)
  expect((screen.getByLabelText('导入章节正文') as HTMLTextAreaElement).value).toContain('原项目不应覆盖')
})
it('merges unchecked boundaries and supports a manual line boundary', async () => {
  await fixture(); render(<ManuscriptImportView />)
  fireEvent.change(screen.getByLabelText(/^原稿文件/u), { target: { files: [file('# 新章甲\n甲正文\n# 新章乙\n乙正文')] } })
  const boundary = await screen.findByLabelText('第3行 · 新章乙')
  fireEvent.click(boundary)
  fireEvent.change(screen.getByLabelText('手动分章行号'), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: '添加分章位置' }))
  fireEvent.click(screen.getByRole('button', { name: '生成分章预览' }))
  expect((screen.getByLabelText('导入章节正文') as HTMLTextAreaElement).value).toBe('# 新章甲\n甲正文\n# 新章乙\n')
  fireEvent.change(screen.getByLabelText('预览章节'), { target: { value: '1' } })
  expect((screen.getByLabelText('导入章节正文') as HTMLTextAreaElement).value).toBe('乙正文')
})
it('retries an ambiguous success with the same request instead of duplicating chapters', async () => {
  const { path, data } = await fixture(); render(<ManuscriptImportView />); await preview()
  const original = projectApi.importManuscript
  const calls: string[] = []
  vi.spyOn(projectApi, 'importManuscript').mockImplementation(async input => {
    calls.push(input.requestId)
    const result = await original(input)
    if (calls.length === 1) throw new Error('模拟响应中断')
    return result
  })
  confirm(); await screen.findByText(/模拟响应中断/)
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
  await screen.findByText(/已导入2个章节/)
  expect(calls).toHaveLength(2); expect(calls[0]).toBe(calls[1])
  expect((await projectApi.open(path)).nodes).toHaveLength(data.nodes.length + 2)
})
it('ignores late file reads after switching project sessions', async () => {
  await fixture(); render(<ManuscriptImportView />)
  let resolve!: (value: ArrayBuffer) => void
  const old = new File(['old'], 'old.txt')
  Object.defineProperty(old, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(done => { resolve = done }) })
  fireEvent.change(screen.getByLabelText(/^原稿文件/u), { target: { files: [old] } })
  await act(async () => { await fixture(); resolve(new TextEncoder().encode('# 迟到内容').buffer) })
  expect(screen.queryByRole('button', { name: '生成分章预览' })).toBeNull()
  expect(screen.queryByText('old.txt')).toBeNull()
})
it('does not create chapters twice while the first import is pending', async () => {
  await fixture(); render(<ManuscriptImportView />); await preview()
  let finish!: () => void
  const original = projectApi.importManuscript
  const request = vi.spyOn(projectApi, 'importManuscript').mockImplementation(async input => { await new Promise<void>(resolve => { finish = resolve }); return original(input) })
  confirm()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '正在导入…' }))
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  await screen.findByText(/已导入2个章节/)
})
