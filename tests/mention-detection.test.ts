import { describe, expect, it } from 'vitest'
import { buildMentionIndex, insertMentionWiki, scanMentions } from '../src/lib/mention-detection'
import type { EntityRecord } from '../src/lib/types'

function entity(id: string, kind: 'character' | 'location' | 'world', title: string, alias = ''): EntityRecord {
  return {
    id,
    kind,
    title,
    content: alias ? { alias } : {},
    tags: [],
    filePath: `${kind}/${id}.md`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('mention detection', () => {
  const entities = [
    entity('c1', 'character', '林月', '月月，Moon Lin'),
    entity('l1', 'location', '雾港', 'Misty Harbor'),
    entity('l2', 'location', '雾港酒馆'),
    entity('w1', 'world', '星辉魔法', '星术'),
  ]

  it('matches known Chinese titles and aliases', () => {
    const mentions = scanMentions('林月和月月研究星术。', entities)
    expect(mentions.map((item) => [item.text, item.kind, item.entityId])).toEqual([
      ['林月', 'character', 'c1'],
      ['月月', 'character', 'c1'],
      ['星术', 'world', 'w1'],
    ])
  })

  it('matches English names on word boundaries without case sensitivity', () => {
    const mentions = scanMentions('moon lin arrived at MISTY HARBOR.', entities)
    expect(mentions.map((item) => item.entityId)).toEqual(['c1', 'l1'])
  })

  it('prefers the longer known entity when names overlap', () => {
    const mentions = scanMentions('她走进雾港酒馆。', entities)
    expect(mentions.filter((item) => item.status === 'known').map((item) => item.text)).toEqual(['雾港酒馆'])
  })

  it('excludes fenced code, inline code, URLs, link destinations, image paths and Wiki links', () => {
    const content = [
      '正文中的林月。',
      '`林月`',
      '```md',
      '林月与雾港',
      '```',
      'https://example.test/林月',
      '[林月](https://example.test/雾港)',
      '![林月](images/雾港.png)',
      '[[林月]]',
    ].join('\n')
    const mentions = scanMentions(content, entities)
    expect(mentions.filter((item) => item.status === 'known').map((item) => item.text)).toEqual(['林月', '林月', '林月'])
  })

  it('discovers predictable local candidates for characters, locations and world terms', () => {
    const mentions = scanMentions('苏晴推开青石客栈的大门，并学习星尘秘术。', [])
    expect(mentions.some((item) => item.text === '苏晴' && item.kind === 'character')).toBe(true)
    expect(mentions.some((item) => item.text === '青石客栈' && item.kind === 'location')).toBe(true)
    expect(mentions.some((item) => item.text === '星尘秘术' && item.kind === 'world')).toBe(true)
  })

  it('marks permanent ignored candidates without losing their positions', () => {
    const mentions = scanMentions('老师走进白石城。', [], ['老师', '白石城'])
    expect(mentions).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '白石城', status: 'ignored' }),
    ]))
    expect(mentions.some((item) => item.text === '老师')).toBe(false)
  })

  it('recomputes results after an entity is deleted or renamed', () => {
    expect(scanMentions('林月来到雾港。', entities).some((item) => item.entityId === 'c1')).toBe(true)
    expect(scanMentions('林月来到雾港。', entities.filter((item) => item.id !== 'c1')).some((item) => item.entityId === 'c1')).toBe(false)
    const renamed = entities.map((item) => item.id === 'c1' ? { ...item, title: '林雪', content: {} } : item)
    expect(scanMentions('林雪来到雾港。', renamed).some((item) => item.entityId === 'c1')).toBe(true)
  })

  it('builds reproducible per-document and per-entity appearance records', () => {
    const index = buildMentionIndex([
      { nodeId: 'chapter-1', content: '林月来到雾港。林月回头。' },
      { nodeId: 'chapter-2', content: '雾港酒馆里，林月正在等待。' },
    ], entities)
    expect(index.byEntity.c1).toEqual([
      { nodeId: 'chapter-1', count: 2 },
      { nodeId: 'chapter-2', count: 1 },
    ])
    expect(index.byEntity.l2).toEqual([{ nodeId: 'chapter-2', count: 1 }])
  })

  it('inserts Wiki syntax only when the source range still matches', () => {
    const [mention] = scanMentions('林月推开门。', entities)
    expect(insertMentionWiki('林月推开门。', mention)).toBe('[[林月]]推开门。')
    expect(insertMentionWiki('内容已经变化。', mention)).toBe('内容已经变化。')
  })
})
