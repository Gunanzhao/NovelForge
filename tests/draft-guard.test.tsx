import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useUnsavedDraft } from '../src/hooks/useUnsavedDraft'
import { UnsavedChangesDialog } from '../src/components/UnsavedChangesDialog'
import { confirmDraftNavigation, decideDraftNavigation, dirtyDrafts, runGuarded, saveActiveDrafts } from '../src/lib/draft-guard'
afterEach(async () => { await act(async () => { await decideDraftNavigation('cancel') }); cleanup() })
function Form({ save }: { save: (value: string) => Promise<boolean> }) {
  const [value, setValue] = useState('')
  const [baseline, setBaseline] = useState('')
  useUnsavedDraft('test', '人物资料', value !== baseline, async () => { if (!await save(value)) return false; setBaseline(value); return true }, () => setValue(baseline))
  return <><input aria-label="姓名" value={value} onChange={event => setValue(event.target.value)} /><UnsavedChangesDialog /></>
}
it('cancel retains content; discard restores it before navigation', async () => {
  const save = vi.fn().mockResolvedValue(true); render(<Form save={save} />)
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '林月' } })
  let allowed!: Promise<boolean>; act(() => { allowed = confirmDraftNavigation() })
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(await allowed).toBe(false); expect(dirtyDrafts()).toHaveLength(1)
  act(() => { allowed = confirmDraftNavigation() }); fireEvent.click(screen.getByRole('button', { name: '放弃修改并离开' }))
  expect(await allowed).toBe(true); expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe(''); expect(save).not.toHaveBeenCalled()
})
it('save failures block navigation and retain the latest form for retry', async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true); render(<Form save={save} />)
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '林月' } })
  let allowed!: Promise<boolean>; act(() => { allowed = confirmDraftNavigation() })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存后离开' })) })
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('人物资料未保存'))
  expect(dirtyDrafts()).toHaveLength(1)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存后离开' })) })
  expect(await allowed).toBe(true); expect(save).toHaveBeenLastCalledWith('林月'); expect(dirtyDrafts()).toHaveLength(0)
})
it('manual save clears dirty state and only the first queued navigation runs', async () => {
  const save = vi.fn().mockResolvedValue(true); render(<Form save={save} />)
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '首稿' } })
  await act(async () => { expect(await saveActiveDrafts()).toBe(true) }); expect(dirtyDrafts()).toHaveLength(0)
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '次稿' } })
  const first = vi.fn(), second = vi.fn(); act(() => { runGuarded(first); runGuarded(second) })
  await act(async () => { await decideDraftNavigation('save') }); expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled()
})
