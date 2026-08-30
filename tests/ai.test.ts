import { describe, expect, it } from 'vitest'
import {
  applyAiSelectionResult, buildAiPrompt, contextItems, estimateContextBudget, paragraphRange,
  recentChapterIds, localAssist, readAiPreferences, writeAiPreferences,
} from '../src/lib/ai-data'
import type { EntityRecord, NodeRecord } from '../src/lib/types'

function node(id: string, kind: NodeRecord['kind'], title: string, parentId: string | null, orderIndex: number): NodeRecord {
  return { id, kind, title, parentId, orderIndex, status: 'draft', filePath: kind + '/' + id + '.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
}

function entity(id: string, title: string): EntityRecord {
  return { id, kind: 'character', title, content: {}, tags: [], filePath: 'character/' + id + '.md', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
}

describe('AI context helpers', () => {
  it('builds an explicit context prompt and local fallback without a key', () => {
    const prompt = buildAiPrompt('continue', [{ title: '第一章', kind: '正文', content: '林月走进雾港。' }], '保持第一人称')
    expect(prompt).toContain('明确选中的上下文')
    expect(prompt).toContain('林月走进雾港')
    const local = localAssist('summary', [{ title: '第一章', kind: '正文', content: '林月走进雾港。' }], '')
    expect(local.model).toBe('novelforge-local')
    expect(local.localContent).toContain('本地摘要草稿')
    expect(local.apiKey).toBe('')
  })

  it('persists endpoint/model preferences but has no API key field', () => {
    writeAiPreferences({ endpoint: 'http://127.0.0.1:1234/v1', model: 'local-model' })
    const preferences = readAiPreferences()
    expect(preferences).toEqual({ endpoint: 'http://127.0.0.1:1234/v1', model: 'local-model' })
    expect(JSON.stringify(localStorage)).not.toContain('apiKey')
  })

  it('captures the current paragraph and selection as explicit context items', () => {
    const content = '第一段第一行\n第一段第二行\n\n第二段'
    expect(paragraphRange(content, 3)).toEqual({ from: 0, to: 13, text: '第一段第一行\n第一段第二行' })
    const items = contextItems(
      [node('chapter-1', 'chapter', '第一章', 'volume-1', 0)],
      [entity('person-1', '林月')],
      'chapter-1',
      content,
      { nodeId: 'chapter-1', from: 0, to: 5, text: '第一段' },
    )
    expect(items.slice(0, 2).map((item) => item.kind)).toEqual(['selection', 'paragraph'])
    expect(items[0].detail).toContain('3')
  })

  it('selects recent chapters in volume and chapter order and reports budget', () => {
    const nodes = [
      node('v1', 'volume', '第一卷', null, 0),
      node('c1', 'chapter', '第一章', 'v1', 0),
      node('c2', 'chapter', '第二章', 'v1', 1),
      node('v2', 'volume', '第二卷', null, 1),
      node('c3', 'chapter', '第三章', 'v2', 0),
    ]
    expect(recentChapterIds(nodes, 'c3', 3)).toEqual(['c1', 'c2', 'c3'])
    expect(recentChapterIds(nodes, 'c3', 1)).toEqual(['c3'])
    const budget = estimateContextBudget([{ title: '段落', kind: '选区', content: '林月' }], 2)
    expect(budget.characters).toBe(2)
    expect(budget.estimatedTokens).toBe(1)
    expect(budget.overLimit).toBe(false)
  })

  it('applies AI results to a selection without replacing the chapter', () => {
    expect(applyAiSelectionResult('甲原文乙', 1, 3, '新', 'replace')).toBe('甲新乙')
    expect(applyAiSelectionResult('甲原文乙', 1, 3, '新', 'insert-after')).toBe('甲原文新乙')
  })
})
