import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Disclosure } from '../src/components/Disclosure'
import { ExportDialog } from '../src/components/ExportDialog'
import type { ProjectData, NodeRecord } from '../src/lib/types'
const chapter: NodeRecord = { id: 'chapter', kind: 'chapter', parentId: 'volume', title: '第一章', filePath: 'manuscript/v/c.md', status: 'draft', orderIndex: 0, createdAt: '', updatedAt: '' }
const data: ProjectData = { project: { id: 'p', title: '测试', author: '', genre: '', description: '', targetWords: 1000, formatVersion: 1, createdAt: '', updatedAt: '' }, nodes: [{ ...chapter, id: 'volume', kind: 'volume', parentId: null, filePath: 'manuscript/v', title: '第一卷' }, chapter], entities: [], recovery: [] }
beforeEach(() => localStorage.clear())
afterEach(cleanup)
it('collapsing a disclosure retains draft values and remembers its state', async () => {
  const view = render(<Disclosure title="补充信息" storageKey="test"><input aria-label="草稿" defaultValue="原文" /></Disclosure>)
  const details = view.container.querySelector('details')!
  fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '未保存的草稿' } })
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')) })
  expect(localStorage.getItem('novelforge:disclosure:test')).toBe('true')
  await act(async () => { details.open = false; fireEvent(details, new Event('toggle')) })
  expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('未保存的草稿')
  view.unmount()
  const next = render(<Disclosure title="补充信息" storageKey="test" defaultOpen>内容</Disclosure>)
  expect(next.container.querySelector('details')!.open).toBe(false)
})
it('selecting an export format does not export until confirmed, and summarizes its scope', async () => {
  const onExport = vi.fn(async () => {})
  render(<ExportDialog open data={data} onClose={vi.fn()} onExport={onExport} />)
  fireEvent.click(screen.getByRole('button', { name: /^纯文本 TXT/ }))
  expect(onExport).not.toHaveBeenCalled()
  expect(screen.getByText('纯文本 TXT · 1 章')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('导出范围'), { target: { value: 'chapters' } })
  expect((screen.getByRole('button', { name: '导出 纯文本 TXT' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '第一章' }))
  fireEvent.click(screen.getByRole('button', { name: '导出 纯文本 TXT' }))
  await waitFor(() => expect(onExport).toHaveBeenCalledWith('txt', expect.objectContaining({ scope: 'chapters', nodeIds: ['chapter'] })))
})
