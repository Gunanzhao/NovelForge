import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '../src/components/MarkdownPreview'

describe('MarkdownPreview footnotes', () => {
  it('renders numbered and named footnotes with matching reference and back anchors', () => {
    render(<MarkdownPreview
      markdown={'正文[^1] 再次引用[^1]，另有命名脚注[^note]。\n\n[^1]: 中文编号脚注\n[^note]: 中文命名脚注'}
      onWikiLink={vi.fn()}
    />)

    const references = screen.getAllByRole('link').filter((link) => link.hasAttribute('data-footnote-ref'))
    expect(references).toHaveLength(3)
    expect(references[0].getAttribute('href')).toBe('#user-content-fn-1')
    expect(references[1].getAttribute('href')).toBe('#user-content-fn-1')
    expect(references[2].getAttribute('href')).toBe('#user-content-fn-note')
    expect(screen.getByRole('heading', { name: '脚注' })).toBeTruthy()
    expect(screen.getByText('中文编号脚注')).toBeTruthy()
    expect(screen.getByText('中文命名脚注')).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回正文 1-2' }).getAttribute('href')).toBe('#user-content-fnref-1-2')
  })

  it('does not parse pseudo-footnotes inside inline or fenced code', () => {
    render(<MarkdownPreview
      markdown={'正文[^live]。\n\n`[^inline]`\n\n```md\n[^fenced]\n```\n\n[^live]: 可见脚注'}
      onWikiLink={vi.fn()}
    />)

    expect(screen.getAllByRole('link').filter((link) => link.hasAttribute('data-footnote-ref'))).toHaveLength(1)
    expect(screen.getByText('[^inline]')).toBeTruthy()
    expect(screen.getByText('[^fenced]')).toBeTruthy()
    expect(screen.getByText('可见脚注')).toBeTruthy()
  })
})
