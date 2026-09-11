import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MarkdownPreview } from '../src/components/MarkdownPreview'
import { useAppStore } from '../src/stores/app-store'
it('does not expose a remote image src until consent, and resets for a new source or project', () => {
  const onWikiLink = () => {}
  const view = render(<MarkdownPreview markdown="![reference](https://example.com/a.png)" onWikiLink={onWikiLink} />)
  expect(view.container.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '加载外部图片' }))
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
  view.rerender(<MarkdownPreview markdown="![reference](https://example.com/b.png)" onWikiLink={onWikiLink} />)
  expect(view.container.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '加载外部图片' }))
  useAppStore.setState(state => ({ projectSession: state.projectSession + 1 }))
  view.rerender(<MarkdownPreview markdown="![reference](https://example.com/b.png)" onWikiLink={onWikiLink} />)
  expect(view.container.querySelector('img')).toBeNull()
})
