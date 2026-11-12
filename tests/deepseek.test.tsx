import { useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  aiModels: vi.fn(),
  aiComplete: vi.fn(),
  aiCancel: vi.fn(async () => {}),
}))
vi.mock('../src/lib/api', () => ({ isDesktop: true, projectApi: api }))
import { ProviderSettings } from '../src/components/ProviderSettings'
import { AiAssistantView } from '../src/components/AiAssistantView'
import { NameAiPanel } from '../src/components/NameAiPanel'
import { deepseekPreset, providerRequest } from '../src/lib/ai-provider'
import {
  readAiPreferences,
  writeAiPreferences,
  type AiPreferences,
} from '../src/lib/ai-data'
import { useAppStore } from '../src/stores/app-store'
import { useAiTask } from '../src/stores/ai-task'
import type { NodeRecord, ProjectData } from '../src/lib/types'

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useAppStore.setState(useAppStore.getInitialState())
  useAiTask.setState(useAiTask.getInitialState(), true)
})
afterEach(cleanup)

function Settings() {
  const [value, change] = useState<AiPreferences>({
    endpoint: 'http://localhost:1234/v1',
    model: 'local',
  })
  const [key, setKey] = useState('old-key')
  return (
    <ProviderSettings
      value={value}
      onChange={(next) => {
        change(next)
        writeAiPreferences(next)
      }}
      apiKey={key}
      onKeyChange={setKey}
    />
  )
}

it('switches to the DeepSeek preset, clears old credentials, and persists thinking without secrets', () => {
  render(<Settings />)
  fireEvent.change(screen.getByLabelText('服务预设'), {
    target: { value: 'deepseek' },
  })
  expect(screen.getByLabelText('Base URL')).toHaveProperty(
    'value',
    'https://api.deepseek.com/chat/completions',
  )
  expect(screen.getByLabelText('模型')).toHaveProperty(
    'value',
    'deepseek-flash',
  )
  expect(screen.getByLabelText(/^DeepSeek API Key/)).toHaveProperty('value', '')
  fireEvent.change(screen.getByLabelText(/^DeepSeek API Key/), {
    target: { value: 'test-secret' },
  })
  fireEvent.change(screen.getByLabelText('思考模式'), {
    target: { value: 'enabled' },
  })
  expect(screen.getByLabelText(/^Temperature/)).toHaveProperty('disabled', true)
  expect(readAiPreferences()).toMatchObject({
    providerKind: 'deepseek',
    thinking: 'enabled',
    maxTokens: 16384,
    stream: true,
  })
  expect(JSON.stringify(localStorage)).not.toContain('test-secret')
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'http://localhost:9999/v1' },
  })
  expect(screen.getByLabelText(/^DeepSeek API Key/)).toHaveProperty('value', '')
})

it('checks only models and discards replies for an edited connection', async () => {
  let resolve!: (value: { id: string }[]) => void
  api.aiModels.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  render(<Settings />)
  fireEvent.click(screen.getByRole('button', { name: '检查连接 / 获取模型' }))
  expect(api.aiModels).toHaveBeenCalledWith(
    'http://localhost:1234/v1',
    'old-key',
    'compatible',
  )
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'http://localhost:9999/v1' },
  })
  await act(async () => resolve([{ id: 'old-provider-model' }]))
  expect(screen.queryByText('old-provider-model')).toBeNull()
  expect(api.aiComplete).not.toHaveBeenCalled()
  api.aiModels.mockResolvedValueOnce([{ id: 'new-provider-model' }])
  fireEvent.click(screen.getByRole('button', { name: '检查连接 / 获取模型' }))
  expect(await screen.findByText(/连接成功，发现 1 个模型/)).toBeTruthy()
})

it('keeps vendor options out of generic requests and enforces separate output limits', () => {
  const config = deepseekPreset({ endpoint: '', model: '' })
  expect(() => providerRequest(config, '', 's', 'p')).toThrow('API Key')
  expect(
    providerRequest({ ...config, maxTokens: 999999 }, 'test', 's', 'p'),
  ).toMatchObject({ thinking: 'disabled', maxTokens: 65536, stream: true })
  const generic = providerRequest(
    {
      endpoint: 'http://localhost/v1',
      model: 'local',
      maxTokens: 999999,
      thinking: 'enabled',
    },
    '',
    's',
    'p',
  )
  expect(generic.maxTokens).toBe(32000)
  expect(generic.thinking).toBeUndefined()
  expect(generic.reasoningEffort).toBeUndefined()
  writeAiPreferences({ ...config, apiKey: 'must-not-persist' } as AiPreferences)
  expect(JSON.stringify(localStorage)).not.toContain('must-not-persist')
})

function project() {
  const node: NodeRecord = {
    id: 'c',
    title: '雨夜',
    kind: 'chapter',
    parentId: null,
    filePath: 'c.md',
    orderIndex: 0,
    status: 'draft',
    createdAt: '',
    updatedAt: '',
  }
  const data: ProjectData = {
    project: {
      id: 'p',
      title: '测试',
      author: '',
      genre: '',
      description: '',
      targetWords: 1000,
      formatVersion: 1,
      createdAt: '',
      updatedAt: '',
    },
    nodes: [node],
    entities: [],
    recovery: [],
  }
  useAppStore.setState({
    projectPath: 'deepseek-test',
    projectSession: 7,
    data,
    document: { node, content: '原文不变。' },
    saveState: 'saved',
    editorSelection: null,
    requestedAiAction: null,
  })
}

it('sends selected thinking settings, shows streaming text and usage, and blocks application until completion', async () => {
  project()
  let resolve!: (value: {
    content: string
    model: string
    usage: { promptTokens: number; completionTokens: number }
  }) => void
  api.aiComplete.mockImplementation((_input, _id, onContent) => {
    onContent('正在形成的正文')
    return new Promise((done) => {
      resolve = done
    })
  })
  render(<AiAssistantView />)
  fireEvent.click(screen.getByRole('button', { name: '连接 DeepSeek' }))
  const dialog = screen.getByRole('dialog', { name: 'AI 服务连接设置' })
  fireEvent.change(within(dialog).getByLabelText(/^DeepSeek API Key/), {
    target: { value: 'test-key' },
  })
  fireEvent.change(within(dialog).getByLabelText('思考模式'), {
    target: { value: 'enabled' },
  })
  fireEvent.change(within(dialog).getByLabelText('思考强度'), {
    target: { value: 'low' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  fireEvent.click(screen.getByRole('button', { name: '运行辅助' }))
  const output = await screen.findByLabelText('AI 结果')
  expect(output).toHaveProperty('readOnly', true)
  expect(output).toHaveProperty('value', '正在形成的正文')
  expect(api.aiComplete.mock.calls[0][0]).toMatchObject({
    providerKind: 'deepseek',
    thinking: 'enabled',
    reasoningEffort: 'low',
    stream: true,
    timeoutSeconds: 300,
  })
  expect(screen.queryByRole('button', { name: '追加到正文' })).toBeNull()
  await act(async () =>
    resolve({
      content: '完成的正文',
      model: 'deepseek-flash',
      usage: { promptTokens: 10, completionTokens: 20 },
    }),
  )
  expect(screen.getByText('输入 10 · 输出 20 Token')).toBeTruthy()
  expect(useAppStore.getState().document?.content).toBe('原文不变。')
})

it('the name generator uses the same DeepSeek options and accepts only complete JSON', async () => {
  project()
  writeAiPreferences({
    ...deepseekPreset({ endpoint: '', model: '' }),
    thinking: 'enabled',
    reasoningEffort: 'low',
    maxTokens: 16384,
  })
  api.aiComplete.mockResolvedValue({
    content: '[{"name":"林舟","explanation":"航行意象"}]',
    model: 'deepseek-flash',
    incomplete: false,
  })
  const accept = vi.fn()
  render(
    <NameAiPanel
      category="character"
      style="中文古风"
      count={1}
      rules={{}}
      excluded={[]}
      onResults={accept}
    />,
  )
  fireEvent.change(screen.getByLabelText(/^DeepSeek API Key/), {
    target: { value: 'name-test-key' },
  })
  fireEvent.click(screen.getByRole('button', { name: '发送并生成 AI 名字' }))
  await waitFor(() => expect(accept).toHaveBeenCalledOnce())
  expect(api.aiComplete.mock.calls[0][0]).toMatchObject({
    providerKind: 'deepseek',
    thinking: 'enabled',
    reasoningEffort: 'low',
    maxTokens: 16384,
    stream: true,
  })
})
