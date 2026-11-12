import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { reviewBlocks, reviewDiff } from '../src/lib/review-diff'
import { RevisionDiff } from '../src/components/RevisionDiff'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('keeps long unchanged passages while reconstructing both versions exactly', () => {
  const original = Array.from({ length: 1800 }, (_, i) => `第${i}行`).join('\n')
  const candidate = original.replace('第20行', '新段落\n新增一行').replace('第1200行', '另一处修改')
  const lines = reviewDiff(original, candidate)
  expect(lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n')).toBe(original)
  expect(lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n')).toBe(candidate)
  expect(reviewBlocks(lines).filter(block => block.changed)).toHaveLength(2)
})
it('does not lose lines in large rewritten or repetitive blocks', () => {
  const original = Array.from({ length: 1000 }, (_, i) => i % 3 ? '重复' : '旧行').join('\n')
  const candidate = '全新行\n'.repeat(1200) + '结尾'
  const lines = reviewDiff(original, candidate)
  expect(lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n')).toBe(original)
  expect(lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n')).toBe(candidate)
})
it('collapses unchanged lines and cycles both directions with correct initial previous target', () => {
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  const original = Array.from({ length: 1000 }, (_, i) => `行${i}`).join('\n')
  const candidate = original.replace('行20\n', '改20\n').replace('行900\n', '改900\n')
  render(<RevisionDiff original={original} candidate={candidate} />)
  expect(screen.getAllByText(/展开 .* 行未改正文/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '上一处差异' }))
  expect(screen.getByRole('status').textContent).toBe('2 / 2 处差异')
  expect(document.activeElement?.textContent).toContain('改900')
  fireEvent.click(screen.getByRole('button', { name: '下一处差异' }))
  expect(document.activeElement?.textContent).toContain('改20')
})
