import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '../src/components/MarkdownPreview'
import { markdownUrlTransform, safeMarkdownUrl } from '../src/lib/safe-url'

describe('Markdown URL security', () => {
  it.each([
    ['https://example.com/path', 'link', 'https://example.com/path'],
    ['HTTP://example.com', 'link', 'HTTP://example.com'],
    ['mailto:author@example.com', 'link', 'mailto:author@example.com'],
    ['#chapter-1', 'link', '#chapter-1'],
    ['./chapter.md', 'link', './chapter.md'],
    [' novelforge-wiki:%E4%BA%BA%E7%89%A9 ', 'link', 'novelforge-wiki:%E4%BA%BA%E7%89%A9'],
    ['data:image/png;base64,AA==', 'image', 'data:image/png;base64,AA=='],
    ['https://example.com/cover.png', 'image', 'https://example.com/cover.png'],
  ] as const)('allows %s for %s', (url, kind, expected) => {
    expect(safeMarkdownUrl(url, kind)).toBe(expected)
  })

  it.each([
    ['javascript:alert(1)', 'link'],
    ['JaVaScRiPt:alert(1)', 'link'],
    ['file:///C:/secret.txt', 'link'],
    ['data:text/html;base64,PHNjcmlwdD4=', 'link'],
    ['data:image/svg+xml,<svg onload=alert(1)>', 'image'],
    ['custom:payload', 'link'],
    ['//example.com/path', 'link'],
    ['\\\\server\\share', 'link'],
    ['https://example.com/\u0000secret', 'link'],
  ] as const)('rejects %s for %s', (url, kind) => {
    expect(safeMarkdownUrl(url, kind)).toBeUndefined()
  })

  it('uses image rules for src and link rules for href', () => {
    expect(markdownUrlTransform('data:image/gif;base64,R0lGODlhAQ==', 'src')).toContain('data:image/gif')
    expect(markdownUrlTransform('data:image/gif;base64,R0lGODlhAQ==', 'href')).toBeUndefined()
  })

  it('renders unsafe links and images as text while preserving safe and wiki links', () => {
    const onWikiLink = vi.fn()
    render(<MarkdownPreview
      markdown={'[危险](javascript:alert(1)) ![危险图片](file:///tmp/a.png) [官网](https://example.com) [[人物甲]]'}
      onWikiLink={onWikiLink}
    />)

    expect(screen.queryByRole('link', { name: '危险' })).toBeNull()
    expect(screen.getByText('危险')).toBeTruthy()
    expect(screen.queryByRole('img', { name: '危险图片' })).toBeNull()
    expect(screen.getByText('危险图片')).toBeTruthy()
    expect(screen.getByRole('link', { name: '官网' }).getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(screen.getByRole('link', { name: '人物甲（未建档）' }))
    expect(onWikiLink).toHaveBeenCalledWith('人物甲')
  })
})
