import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NodeDialog } from '../src/components/ProjectDialogs'
import { useAppStore } from '../src/stores/app-store'

afterEach(() => { cleanup(); useAppStore.setState(useAppStore.getInitialState(),true) })
it('allows only one create request while Enter is repeated', async () => {
  let finish!:()=>void
  const pending = new Promise<void>(resolve=>{finish=resolve})
  const createNode=vi.fn(()=>pending)
  useAppStore.setState({createNode})
  render(<NodeDialog kind="chapter" parentId="v" onClose={vi.fn()} />)
  const input=screen.getByPlaceholderText('第二章')
  fireEvent.change(input,{target:{value:'重复章节'}})
  fireEvent.keyDown(input,{key:'Enter'})
  fireEvent.keyDown(input,{key:'Enter'})
  expect(createNode).toHaveBeenCalledTimes(1)
  await act(async()=>{finish();await pending})
})


it('retains the title and allows retry after creation fails', async () => {
  const createNode = vi.fn().mockRejectedValueOnce(new Error('创建失败')).mockResolvedValueOnce(undefined)
  const onClose = vi.fn()
  useAppStore.setState({ createNode })
  render(<NodeDialog kind="chapter" parentId="v" onClose={onClose} />)
  fireEvent.change(screen.getByPlaceholderText('第二章'), {target:{value:'保留标题'}})
  await act(async () => { fireEvent.click(screen.getByRole('button', {name:'创建'})) })
  expect(screen.getByRole('alert').textContent).toContain('创建失败')
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', {name:'创建'})) })
  expect(createNode).toHaveBeenLastCalledWith('chapter', '保留标题', 'v')
  expect(onClose).toHaveBeenCalledOnce()
})
