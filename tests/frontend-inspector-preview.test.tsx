import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityRecord, NodeRecord, ProjectData } from '../src/lib/types'

const api = vi.hoisted(() => ({ consistency: vi.fn(), getDocument: vi.fn(), aiComplete: vi.fn() }))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: api }))
import { StoryArcInspector } from '../src/components/StoryArcInspector'
import { ConsistencyView } from '../src/components/ConsistencyView'
import { AiAssistantView } from '../src/components/AiAssistantView'
import { useAppStore } from '../src/stores/app-store'
import { AI_CONTEXT_SAFE_CHAR_LIMIT, writeAiPreferences } from '../src/lib/ai-data'

const chapter: NodeRecord = { id: 'chapter', kind: 'chapter', parentId: null, title: '第一章', orderIndex: 0, status: 'draft', filePath: '', createdAt: '', updatedAt: '' }
const section: NodeRecord = { ...chapter, id: 'section', kind: 'section', parentId: chapter.id }
const arc: EntityRecord = { id: 'arc', kind: 'story-arc', title: '主线', tags: [], content: { chapterIds: ['chapter'] }, filePath: '', createdAt: '', updatedAt: '' }
const data: ProjectData = { project: { formatVersion: 1, id: 'project', title: '测试', author: '', description: '', genre: '', targetWords: 1, createdAt: '', updatedAt: '' }, nodes: [chapter, section], entities: [arc], recovery: [] }

beforeEach(() => {
  vi.clearAllMocks()
  api.aiComplete.mockResolvedValue({ content: '结果', model: 'test' })
  writeAiPreferences({ endpoint: 'https://provider.example/v1', model: 'test' })
  useAppStore.setState({ data, projectPath: 'project', document: { node: chapter, content: '正文😀' }, editorSelection: null, requestedAiAction: null, error: null })
})

describe('chapter association and issue navigation', () => {
  it.each([chapter, section])('reads and removes the chapter association from $kind', async (node) => {
    const saveEntity = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ document: { node, content: '' }, saveEntity })
    render(<StoryArcInspector />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(saveEntity).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ chapterIds: [] }) })))
  })

  it('adds the parent chapter rather than the section and preserves other associations', async () => {
    const saveEntity = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ document: { node: section, content: '' }, data: { ...data, entities: [{ ...arc, content: { chapterIds: ['other'] } }] }, saveEntity })
    render(<StoryArcInspector />)
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(saveEntity).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ chapterIds: ['other', 'chapter'] }) })))
  })

  it('does not offer associations for an orphan section', () => {
    useAppStore.setState({ document: { node: { ...section, parentId: 'missing' }, content: '' } })
    render(<StoryArcInspector />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it.each(['story-arc', 'character', 'entity'])('locates an issue using %s', async (refKind) => {
    const entity = refKind === 'character' ? { ...arc, kind: 'character' as const } : arc
    const selectEntity = vi.fn()
    useAppStore.setState({ data: { ...data, entities: [entity] }, selectEntity })
    api.consistency.mockResolvedValue({ checkedAt: '2026-01-01', issueCount: 1, errors: 1, warnings: 0, issues: [{ id: 'issue', severity: 'error', title: '断链', detail: '', path: '', refKind, refId: 'arc', code: 'broken' }] })
    render(<ConsistencyView />)
    fireEvent.click(await screen.findByRole('button', { name: '定位' }))
    expect(selectEntity).toHaveBeenCalledWith(entity.kind, 'arc')
  })
})

describe('complete AI request preview and budget', () => {
  it('previews the exact system and user messages sent, counting Unicode characters across both', async () => {
    const { container } = render(<AiAssistantView />)
    fireEvent.change(screen.getByPlaceholderText('例如：保持第一人称，增加悬念，不改变已有设定…'), { target: { value: '写作要求😀' } })
    fireEvent.click(screen.getByRole('button', { name: '预览上下文' }))
    await screen.findByRole('heading', { name: 'User Prompt' })
    const messages = [...container.querySelectorAll('.ai-preview-panel pre')].map((el) => el.textContent ?? '')
    expect(messages[0]).toContain('NovelForge')
    expect(messages[1]).toContain('任务：续写')
    expect(messages[1]).toContain('写作要求😀')
    expect(messages[1]).toContain('正文😀')
    const count = messages.reduce((sum, text) => sum + Array.from(text).length, 0)
    expect(screen.getByText(`System + User：${count.toLocaleString()} 字符 · 预计 ${Math.ceil(count / 4).toLocaleString()} Token · 安全阈值 ${AI_CONTEXT_SAFE_CHAR_LIMIT.toLocaleString()} 字符`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
    await waitFor(() => expect(api.aiComplete).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: messages[0], prompt: messages[1] })))
    act(() => useAppStore.setState({ document: { node: chapter, content: '修改后的正文' } }))
    fireEvent.click(screen.getByRole('button', { name: '预览上下文' }))
    await waitFor(() => expect(container.querySelectorAll('.ai-preview-panel pre')[1].textContent).toContain('修改后的正文'))
  })

  it('blocks oversized writing instructions even with a small selected context', async () => {
    render(<AiAssistantView />)
    fireEvent.change(screen.getByPlaceholderText('例如：保持第一人称，增加悬念，不改变已有设定…'), { target: { value: '字'.repeat(AI_CONTEXT_SAFE_CHAR_LIMIT) } })
    fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
    await waitFor(() => expect(useAppStore.getState().error).toContain('安全阈值'))
    expect(api.aiComplete).not.toHaveBeenCalled()
  })

  it.each([undefined, '自定义系统😀', '字'.repeat(AI_CONTEXT_SAFE_CHAR_LIMIT), '字'.repeat(AI_CONTEXT_SAFE_CHAR_LIMIT - 6), '字'.repeat(AI_CONTEXT_SAFE_CHAR_LIMIT - 5)])('includes preset system content in preview and execution limits (case %#)', async (systemPrompt) => {
    const preset: EntityRecord = { ...arc, id: 'preset', kind: 'prompt-preset', title: '测试模板', content: { prompt: '分析 {{currentChapter}}', systemPrompt, action: 'analyze' } }
    useAppStore.setState({ data: { ...data, entities: [preset] } })
    render(<AiAssistantView />)
    fireEvent.click(screen.getByRole('button', { name: /测试模板/ }))
    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    const dialog = await screen.findByRole('dialog')
    const messages = [...dialog.querySelectorAll('pre')].map((el) => el.textContent ?? '')
    expect(messages[0]).toBe(systemPrompt ?? '你是 NovelForge 的中文小说创作助手。只处理模板中明确引用的上下文。')
    expect(messages[1]).toBe('分析 正文😀')
    const count = Array.from(messages.join('')).length
    expect(within(dialog).getByText(`字符数：${count.toLocaleString()}`)).toBeTruthy()
    expect(within(dialog).getByText(`估算 Token：${Math.ceil(count / 4).toLocaleString()}`)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认运行' }))
    if (count > AI_CONTEXT_SAFE_CHAR_LIMIT) {
      await waitFor(() => expect(useAppStore.getState().error).toContain('安全阈值'))
      expect(api.aiComplete).not.toHaveBeenCalled()
    } else {
      await waitFor(() => expect(api.aiComplete).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: messages[0], prompt: messages[1] })))
    }
  })
})
