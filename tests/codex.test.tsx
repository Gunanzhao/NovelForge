import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeRecord, ProjectData, AiCompletionResult } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  status: vi.fn(), models: vi.fn(), login: vi.fn(), generate: vi.fn(), cancel: vi.fn(), aiComplete: vi.fn(),
}))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: { aiComplete: mocks.aiComplete } }))
vi.mock('../src/lib/codex', () => ({ codexApi: mocks }))
import { AiAssistantView } from '../src/components/AiAssistantView'
import { readAiPreferences, writeAiPreferences } from '../src/lib/ai-data'
import { useAppStore } from '../src/stores/app-store'

const chapter: NodeRecord = { id: 'chapter', title: '第一章', kind: 'chapter', parentId: null, orderIndex: 0, status: 'draft', filePath: 'chapter.md', createdAt: '', updatedAt: '' }
const data: ProjectData = { project: { id: 'project', title: '测试', author: '', description: '', genre: '', targetWords: 1000, formatVersion: 1, createdAt: '', updatedAt: '' }, nodes: [chapter], entities: [], recovery: [] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.status.mockResolvedValue({ ready: true, version: '0.149.1', authMode: 'chatgpt', planType: 'plus', rateLimits: null })
  mocks.models.mockResolvedValue([{ model: 'writer', displayName: 'Writer', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }])
  mocks.cancel.mockResolvedValue(undefined)
  writeAiPreferences({ endpoint: 'https://example.org', model: 'http-model', mode: 'codex' })
  useAppStore.setState({ projectPath: 'project', data, document: { node: chapter, content: '雨夜。' }, editorSelection: null, error: null })
})
async function ready() {
  render(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '检查连接 / 刷新登录' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '运行辅助' }) as HTMLButtonElement).disabled).toBe(false))
}

describe('Codex writing integration', () => {
  it('migrates old preferences and separates HTTP and Codex settings', () => {
    writeAiPreferences({ endpoint: '', model: 'local' })
    expect(readAiPreferences().mode).toBe('offline')
    writeAiPreferences({ endpoint: 'https://example.org', model: 'http', codexModel: 'writer', codexEffort: 'low' })
    expect(readAiPreferences()).toMatchObject({ mode: 'provider', model: 'http', codexModel: 'writer' })
  })
  it('streams then enables applying a completed result', async () => {
    let finish!: (result: AiCompletionResult) => void
    mocks.generate.mockImplementation((_input, delta) => { delta('风声'); return new Promise((resolve) => { finish = resolve }) })
    await ready()
    expect(screen.queryByPlaceholderText('可选；本地 Provider 通常不需要')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
    expect(await screen.findByDisplayValue('风声')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '追加到正文' })).toBeNull()
    await act(async () => finish({ content: '风声渐紧。', model: 'writer' }))
    fireEvent.click(await screen.findByRole('button', { name: '追加到正文' }))
    expect(useAppStore.getState().document?.content).toContain('风声渐紧。')
    expect(mocks.aiComplete).not.toHaveBeenCalled()
  })
  it('keeps partial output after cancellation and ignores late success', async () => {
    let finish!: (result: AiCompletionResult) => void
    mocks.generate.mockImplementation((_input, delta) => { delta('部分文本'); return new Promise((resolve) => { finish = resolve }) })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
    await screen.findByDisplayValue('部分文本')
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    await act(async () => finish({ content: '迟到的完成文本', model: 'writer' }))
    expect(screen.getByDisplayValue('部分文本')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '追加到正文' })).toBeNull()
  })
  it('blocks applying results when the document changes', async () => {
    mocks.generate.mockResolvedValue({ content: '生成正文', model: 'writer' })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
    await screen.findByDisplayValue('生成正文')
    act(() => useAppStore.setState({ document: { node: chapter, content: '用户继续写作。' } }))
    fireEvent.click(screen.getByRole('button', { name: '追加到正文' }))
    expect(useAppStore.getState().document?.content).toBe('用户继续写作。')
    expect(useAppStore.getState().error).toContain('已变化')
  })
  it('does not enable subscription generation for API-key authentication', async () => {
    mocks.status.mockResolvedValue({ ready: false, version: '0.149.1', authMode: 'apiKey' })
    render(<AiAssistantView />)
    fireEvent.click(screen.getByRole('button', { name: '检查连接 / 刷新登录' }))
    await screen.findByText(/当前不是 ChatGPT 订阅登录/)
    expect((screen.getByRole('button', { name: '运行辅助' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.models).not.toHaveBeenCalled()
  })
  it('supports an explicit browser login and cancellation without logout', async () => {
    mocks.status.mockResolvedValue({ ready: false, version: '0.149.1', authMode: 'none' })
    mocks.login.mockResolvedValue(null)
    render(<AiAssistantView />)
    fireEvent.click(screen.getByRole('button', { name: '检查连接 / 刷新登录' }))
    fireEvent.click(await screen.findByRole('button', { name: '登录 ChatGPT' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消登录' }))
    await waitFor(() => expect(mocks.login).toHaveBeenLastCalledWith('', true))
  })
  it('runs analysis templates through Codex after prompt confirmation', async () => {
    useAppStore.setState({ data: { ...data, entities: [{ id: 'preset', kind: 'prompt-preset', title: '剧情分析', content: { prompt: '分析 {{currentChapter}}', action: 'analyze', defaultContexts: [] }, tags: [], filePath: 'prompts/test.md', createdAt: '', updatedAt: '' }] } })
    mocks.generate.mockResolvedValue({ content: '分析结果', model: 'writer' })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /剧情分析/ }))
    fireEvent.click(await screen.findByRole('button', { name: '运行' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认运行' }))
    await screen.findByDisplayValue('分析结果')
    expect(mocks.generate.mock.calls[0][0].prompt).toContain('分析 雨夜。')
    expect(screen.queryByRole('button', { name: '追加到正文' })).toBeNull()
  })
  it('runs selection polish and rejects a changed selection', async () => {
    useAppStore.setState({ editorSelection: { nodeId: 'chapter', from: 0, to: 2, text: '雨夜' } })
    mocks.generate.mockResolvedValue({ content: '细雨长夜', model: 'writer' })
    await ready()
    fireEvent.change(screen.getByLabelText('任务'), { target: { value: 'polish' } })
    fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
    await screen.findByDisplayValue('细雨长夜')
    act(() => useAppStore.setState({ editorSelection: { nodeId: 'chapter', from: 1, to: 2, text: '夜' } }))
    fireEvent.click(screen.getByRole('button', { name: '替换选区' }))
    expect(useAppStore.getState().error).toContain('选区已变化')
    expect(useAppStore.getState().document?.content).toBe('雨夜。')
  })
  it('keeps the entry closed when runtime compatibility checks fail', async () => {
    mocks.status.mockRejectedValue(new Error('当前版本未通过工具隔离验证'))
    render(<AiAssistantView />)
    fireEvent.click(screen.getByRole('button', { name: '检查连接 / 刷新登录' }))
    await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: '运行辅助' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
