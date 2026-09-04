import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NameGenerator } from '../src/components/NameGenerator'

function displayedNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.name-suggestion > span:first-child'), (element) => element.textContent)
}

describe('name generator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('changes the visible names on generate and regenerate', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { container } = render(<NameGenerator />)

    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    const first = displayedNames(container)
    expect(first).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    const second = displayedNames(container)
    expect(second).not.toEqual(first)

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    const third = displayedNames(container)
    expect(third).not.toEqual(second)
  })
})
