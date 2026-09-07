import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NameGenerator } from '../src/components/NameGenerator'

afterEach(cleanup)

it('在独立弹窗生成名字，关闭重开保留结果，辅助栏只保留入口', () => {
  const { container } = render(<NameGenerator />)
  const entry = screen.getByRole('button', { name: /名字生成器/ })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(entry)
  const dialog = screen.getByRole('dialog', { name: '名字生成器' })
  expect(container.contains(dialog)).toBe(false)
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: '生成数量' }), { target: { value: '30' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '生成' }))
  const copies = within(dialog).getAllByRole('button', { name: /^复制(?!全部)/ })
  expect(copies).toHaveLength(30)
  const firstName = copies[0].getAttribute('aria-label')!
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(entry)
  fireEvent.click(entry)
  expect(screen.getByRole('button', { name: firstName })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: '建档' })).toHaveLength(30)
})
