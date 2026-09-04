import { describe, expect, it } from 'vitest'
import { fallbackInvoke } from '../src/lib/fallback'
import {
  parsePromptPreset, promptPresetContent, resolvePromptTemplate,
} from '../src/lib/prompt-preset'
import type { EditorSelection, EntityRecord, NodeRecord, ProjectData, ProjectInput } from '../src/lib/types'

function node(id: string, orderIndex: number): NodeRecord {
  return {
    id, kind: 'chapter', parentId: 'volume', title: `第${orderIndex + 1}章`, orderIndex,
    status: 'draft', filePath: `manuscript/${id}.md`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

function entity(id: string, kind: EntityRecord['kind'], title: string, content: Record<string, unknown> = {}): EntityRecord {
  return {
    id, kind, title, content, tags: [], filePath: `${kind}/${id}.md`,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

function project(): ProjectData {
  return {
    project: {
      formatVersion: 1, id: 'p1', title: '测试', author: '', description: '', genre: '', targetWords: 1000,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    },
    nodes: [
      { ...node('volume', 0), kind: 'volume', parentId: null },
      node('c1', 0),
      node('c2', 1),
      node('c3', 2),
    ],
    entities: [
      entity('char', 'character', '林月', { personality: '冷静' }),
      entity('location', 'location', '雾港', { description: '常年有雾' }),
      entity('world', 'world', '星辉魔法', { rule: '消耗记忆' }),
      entity('arc', 'story-arc', '寻找星核', { status: 'active' }),
    ],
    recovery: [],
  }
}

describe('prompt preset', () => {
  it('parses and serializes project presets', () => {
    const record = entity('preset', 'prompt-preset', '人物检查', {
      description: '检查 OOC',
      prompt: '{{currentChapter}}',
      systemPrompt: '只分析',
      action: 'analyze',
      defaultContexts: [{ variable: 'currentChapter' }],
    })
    const preset = parsePromptPreset(record)
    expect(preset.name).toBe('人物检查')
    expect(preset.action).toBe('analyze')
    expect(promptPresetContent(preset)).toMatchObject({ prompt: '{{currentChapter}}', action: 'analyze' })
  })

  it('resolves every supported explicit context variable', async () => {
    const data = project()
    const currentContent = '第一段。\n\n林月走进雾港。'
    const selection: EditorSelection = { nodeId: 'c3', from: 5, to: 7, text: '林月' }
    const resolution = await resolvePromptTemplate([
      '{{selection}}',
      '{{currentParagraph}}',
      '{{currentChapter}}',
      '{{recentChapters:3}}',
      '{{character:林月}}',
      '{{location:雾港}}',
      '{{world:星辉魔法}}',
      '{{storyArc:寻找星核}}',
    ].join('\n'), {
      data,
      currentNodeId: 'c3',
      currentContent,
      selection,
      loadDocument: async (id) => `${id} 正文`,
    })
    expect(resolution.errors).toEqual([])
    expect(resolution.prompt).toContain('林月')
    expect(resolution.prompt).toContain('常年有雾')
    expect(resolution.prompt).toContain('消耗记忆')
    expect(resolution.prompt).toContain('寻找星核')
    expect(resolution.prompt).toContain('c1 正文')
    expect(resolution.contexts.map((item) => item.variable)).toHaveLength(8)
    expect(resolution.estimatedTokens).toBeGreaterThan(0)
  })

  it('blocks missing, unknown and invalid context variables', async () => {
    const data = project()
    const resolution = await resolvePromptTemplate('{{selection}} {{character:不存在}} {{recentChapters:2}} {{secretContext}}', {
      data,
      currentNodeId: 'c1',
      currentContent: '正文',
      selection: null,
      loadDocument: async () => '',
    })
    expect(resolution.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('当前没有可用选区'),
      expect.stringContaining('character:不存在'),
      expect.stringContaining('recentChapters:2'),
      expect.stringContaining('secretContext'),
    ]))
    expect(resolution.contexts).toEqual([])
  })

  it('stores prompt presets in the browser project and restores them from trash', async () => {
    const input: ProjectInput = {
      path: 'prompt-preset-project', title: '模板测试', author: '', description: '', genre: '', targetWords: 1000,
    }
    await fallbackInvoke<ProjectData>('create_project', { input })
    const saved = await fallbackInvoke<ProjectData>('upsert_entity', {
      input: {
        projectPath: input.path,
        kind: 'prompt-preset',
        id: null,
        title: 'OOC 检查',
        content: { prompt: '{{character:林月}}', action: 'analyze', defaultContexts: [{ variable: 'character:林月' }] },
        tags: ['AI 模板'],
      },
    })
    const preset = saved.entities.find((item) => item.kind === 'prompt-preset')
    expect(preset).toBeDefined()
    if (!preset) return
    await fallbackInvoke<ProjectData>('delete_entity', { input: { projectPath: input.path, nodeId: preset.id } })
    const trash = await fallbackInvoke<Array<{ id: string; refId: string }>>('list_trash', { path: input.path })
    const item = trash.find((candidate) => candidate.refId === preset.id)
    expect(item).toBeDefined()
    if (!item) return
    const restored = await fallbackInvoke<ProjectData>('restore_trash', { input: { projectPath: input.path, nodeId: item.id } })
    expect(restored.entities.find((candidate) => candidate.id === preset.id)?.title).toBe('OOC 检查')
  })
})
