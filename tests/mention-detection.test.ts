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

  it('keeps linked targets out of suggestions and counts only exact known Wiki targets', () => {
    const content = '林月。[[林月]][[ 月月 ]][[MOON LIN]][[雾港]][[Misty Harbor]][[星辉魔法]][[星术]][[雾港酒馆]][[林月不存在]][[未知城]]'
    expect(scanMentions(content, entities).map((item) => item.text)).toEqual(['林月'])
    expect(scanMentions(content, entities, [], { includeLinkedWikiMentions: false })).toEqual(scanMentions(content, entities))
    const index = buildMentionIndex([{ nodeId: 'chapter-1', content }], entities)
    expect(index.byEntity).toEqual({
      c1: [{ nodeId: 'chapter-1', count: 4 }],
      l1: [{ nodeId: 'chapter-1', count: 2 }],
      l2: [{ nodeId: 'chapter-1', count: 1 }],
      w1: [{ nodeId: 'chapter-1', count: 2 }],
    })
    expect(index.byDocument['chapter-1']).toHaveLength(9)
    for (const mention of index.byDocument['chapter-1']) {
      expect(content.slice(mention.start, mention.end)).toBe(mention.text)
      expect(mention.status).toBe('known')
    }
    expect(buildMentionIndex([{ nodeId: 'c', content: '林月走进房间。[[林月]]拿起书。' }], entities).byEntity.c1).toEqual([{ nodeId: 'c', count: 2 }])
  })

  it('resolves array aliases once, prefers canonical titles, and respects ignored targets', () => {
    const records = [
      { ...entity('a', 'character', '甲甲'), content: { aliases: ['月月', '月月', '林月'] } },
      entity('b', 'character', '林月'),
    ]
    expect(buildMentionIndex([{ nodeId: 'c', content: '[[月月]][[林月]]' }], records).byEntity).toEqual({
      a: [{ nodeId: 'c', count: 1 }], b: [{ nodeId: 'c', count: 1 }],
    })
    expect(buildMentionIndex([{ nodeId: 'c', content: '[[月月]][[林月]]' }], records, ['月月']).byEntity).toEqual({ b: [{ nodeId: 'c', count: 1 }] })
    expect(buildMentionIndex([{ nodeId: 'c', content: '[[月月]][[林月]]' }], []).byEntity).toEqual({})
  })

  const hidden = '林月说。雾港。星辉魔法。[[林月]][[雾港]][[星辉魔法]]'
  it.each([
    ['ordinary fence', `\`\`\`md\n${hidden}\n\`\`\``],
    ['long fence with short and mixed closers', `\`\`\`\`md\n${hidden}\n\`\`\`\n${hidden}\n~~~~\n${hidden}\n\`\`\`\`\``],
    ['tilde fence', `~~~~md\n${hidden}\n~~~\n${hidden}\n\`\`\`\`\n${hidden}\n~~~~`],
    ['arbitrary length fence', `${'~'.repeat(17)}\n${hidden}\n${'~'.repeat(16)}\n${hidden}\n${'~'.repeat(20)}`],
    ['closer with trailing info is not a closer', `\`\`\`\n${hidden}\n\`\`\`text\n${hidden}\n\`\`\``],
    ['inline', `\`${hidden}\``],
    ['multiple backticks', `\`\`${hidden} \` inside \`\``],
    ['longer inline run is not a closer', `\`\`${hidden} \`\`\` ${hidden}\`\``],
    ['multiline inline', `\`\`${hidden}\n${hidden}\`\``],
    ['frontmatter', `---\ntitle: ${hidden}\n---`],
    ['CRLF fence', `   ~~~~md\r\n${hidden}\r\n  ~~~~~\t`],
    ['CR fence', `~~~\r${hidden}\r~~~`],
  ])('protects %s in suggestions and statistics', (_name, protectedText) => {
    expect(scanMentions(protectedText, [])).toEqual([])
    const content = `${protectedText}\n林月。雾港。星辉魔法。`
    expect(buildMentionIndex([{ nodeId: 'c', content }], entities).byEntity).toEqual({
      c1: [{ nodeId: 'c', count: 1 }], l1: [{ nodeId: 'c', count: 1 }], w1: [{ nodeId: 'c', count: 1 }],
    })
  })

  it.each(['```', '```````', '~~~~~'])('protects an unclosed %s fence to EOF', (fence) => {
    const content = `林月。\n${fence}md\n${hidden}`
    expect(buildMentionIndex([{ nodeId: 'c', content }], entities).byEntity).toEqual({ c1: [{ nodeId: 'c', count: 1 }] })
    expect(scanMentions(`${fence}\n${hidden}`, [])).toEqual([])
  })

  it('protects URLs, balanced destinations, images and references but counts visible labels', () => {
    const content = [
      'https://example.test/林月 ftp://example.test/雾港 mailto:林月@example.test',
      '<https://example.test/[[林月]]>',
      '[林月](relative/(雾港)/星辉魔法 "林月")',
      '![林月](images/(雾港)/星辉魔法.png)',
      '[林月](<relative/雾港(星辉魔法)> "林月")',
      '[林月](relative/\\(雾港\\)/星辉魔法)',
      '[林月][雾港]',
      '[雾港]: relative/林月 "星辉魔法"',
      '[正文](relative/[[林月]]) ![正文](images/[[雾港]])',
    ].join('\n')
    expect(buildMentionIndex([{ nodeId: 'c', content }], entities).byEntity).toEqual({ c1: [{ nodeId: 'c', count: 5 }] })
  })
})
