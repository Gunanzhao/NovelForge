import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContextMenuProvider } from '../src/components/ContextMenu'

describe('ContextMenuProvider', () => {
  it('renders a fallback menu and executes an item after a right click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ContextMenuProvider fallbackItems={[{ type: 'item', id: 'save', label: '保存当前正文', onSelect }]}>
        <div>工作台内容</div>
      </ContextMenuProvider>,
    )
    fireEvent.contextMenu(screen.getByText('工作台内容'), { clientX: 40, clientY: 50 })
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: '保存当前正文' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
