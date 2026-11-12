import { useEffect, useId, useRef, useState } from 'react'
import { isDesktop, projectApi } from '../lib/api'
import type { AiPreferences } from '../lib/ai-data'
import {
  DEEPSEEK_MODELS,
  deepseekPreset,
  providerKind,
  providerTokenLimit,
} from '../lib/ai-provider'
import { confirmInsecureAiEndpoint } from '../lib/ai-security'
import type { AiProviderModel } from '../lib/types'
import { Button, Field, TextInput } from './ui'

export function ProviderSettings({
  value,
  onChange,
  apiKey,
  onKeyChange,
  disabled = false,
  endpointLabel = 'Base URL',
}: {
  value: AiPreferences
  onChange: (value: AiPreferences) => void
  apiKey: string
  onKeyChange: (key: string) => void
  disabled?: boolean
  endpointLabel?: string
}) {
  const kind = providerKind(value)
  const deepseek = kind === 'deepseek'
  const thinking = deepseek && value.thinking === 'enabled'
  const [models, setModels] = useState<AiProviderModel[]>([])
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const request = useRef({ version: 0 })
  const confirmed = useRef(new Set<string>())
  const listId = useId()
  useEffect(() => {
    const guard = request.current
    guard.version++
    setChecking(false)
    setModels([])
    setMessage('')
    setFailed(false)
    return () => {
      guard.version++
    }
  }, [value.endpoint, kind, apiKey])
  const change = (patch: Partial<AiPreferences>) =>
    onChange({ ...value, ...patch })
  async function check() {
    if (!isDesktop) {
      setFailed(true)
      setMessage('连接检查需要桌面版。')
      return
    }
    if (!value.endpoint.trim() || (deepseek && !apiKey.trim())) {
      setFailed(true)
      setMessage(deepseek ? '请填写 DeepSeek API Key。' : '请填写服务地址。')
      return
    }
    if (
      !confirmInsecureAiEndpoint(value.endpoint, confirmed.current, (text) =>
        window.confirm(text),
      )
    )
      return
    const id = ++request.current.version
    setChecking(true)
    setMessage('正在检查连接并读取模型列表…')
    setFailed(false)
    try {
      const result = await projectApi.aiModels(value.endpoint, apiKey, kind)
      if (request.current.version !== id) return
      setModels(result)
      setMessage(
        `连接成功，发现 ${result.length} 个模型。此检查未发送小说正文，也未生成内容。`,
      )
    } catch (error) {
      if (request.current.version === id) {
        setFailed(true)
        setMessage(String(error))
      }
    } finally {
      if (request.current.version === id) setChecking(false)
    }
  }
  const suggestions = [
    ...new Set([
      ...models.map((model) => model.id),
      ...(deepseek ? DEEPSEEK_MODELS : []),
    ]),
  ]
  const selected = models.find((model) => model.id === value.model)
  return (
    <fieldset
      disabled={disabled}
      className="ai-provider-fields provider-settings"
    >
      <Field label="服务预设">
        <select
          className="select-input"
          value={kind}
          onChange={(event) => {
            onKeyChange('')
            onChange(
              event.target.value === 'deepseek'
                ? deepseekPreset(value)
                : {
                    ...value,
                    providerKind: 'compatible',
                    providerName: '',
                    endpoint: '',
                    model: '',
                    stream: false,
                    maxTokens: 4000,
                    timeoutSeconds: 120,
                  },
            )
          }}
        >
          <option value="compatible">通用兼容服务</option>
          <option value="deepseek">DeepSeek 官方</option>
        </select>
      </Field>
      <Field label="名称">
        <TextInput
          value={value.providerName ?? ''}
          onChange={(event) => change({ providerName: event.target.value })}
          placeholder="例如：DeepSeek、本地 LM Studio"
        />
      </Field>
      <Field label={endpointLabel} hint="更换服务地址会清除当前密钥。">
        <TextInput
          aria-label={endpointLabel}
          value={value.endpoint}
          onChange={(event) => {
            onKeyChange('')
            change({ endpoint: event.target.value })
          }}
          placeholder={
            deepseek
              ? 'https://api.deepseek.com/chat/completions'
              : 'http://127.0.0.1:1234/v1'
          }
        />
      </Field>
      <Field
        label="模型"
        hint={
          selected?.maxOutputTokens
            ? `服务声明最大输出 ${selected.maxOutputTokens.toLocaleString()} Token；当前应用上限 ${providerTokenLimit(value).toLocaleString()}。`
            : '可输入模型名称，或检查连接后选择服务提供的模型。'
        }
      >
        <TextInput
          aria-label="模型"
          list={listId}
          value={value.model}
          onChange={(event) => change({ model: event.target.value })}
          placeholder="模型名称"
        />
        <datalist id={listId}>
          {suggestions.map((id) => (
            <option key={id} value={id}>
              {models.find((model) => model.id === id)?.name ?? id}
            </option>
          ))}
        </datalist>
      </Field>
      {models.length > 0 && !selected && (
        <p className="field-hint">
          所填模型未出现在返回列表中，请确认模型名称或访问权限。
        </p>
      )}
      <Field
        label={deepseek ? 'DeepSeek API Key' : 'API Key'}
        hint="密钥仅保留在当前面板内，关闭应用后需重新填写。"
      >
        <TextInput
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => onKeyChange(event.target.value)}
          placeholder={
            deepseek ? '填写 DeepSeek API Key' : '可选；本地服务通常不需要'
          }
        />
      </Field>
      <div className="provider-check">
        <Button
          variant="outline"
          disabled={checking}
          onClick={() => void check()}
        >
          {checking ? '正在检查…' : '检查连接 / 获取模型'}
        </Button>
        <span>仅检查鉴权和模型列表</span>
      </div>
      {message && (
        <p
          role={failed ? 'alert' : 'status'}
          className={failed ? 'settings-inline-error' : 'field-hint'}
        >
          {message}
        </p>
      )}
      {deepseek && (
        <div className="field-grid">
          <Field label="思考模式">
            <select
              className="select-input"
              value={value.thinking ?? 'disabled'}
              onChange={(event) =>
                change({
                  thinking: event.target.value as 'enabled' | 'disabled',
                  maxTokens:
                    event.target.value === 'enabled'
                      ? Math.max(16384, value.maxTokens ?? 8192)
                      : value.maxTokens,
                })
              }
            >
              <option value="disabled">普通写作（关闭思考）</option>
              <option value="enabled">深度思考（剧情分析等）</option>
            </select>
          </Field>
          <Field label="思考强度">
            <select
              className="select-input"
              disabled={!thinking}
              value={value.reasoningEffort ?? 'high'}
              onChange={(event) =>
                change({
                  reasoningEffort: event.target.value as 'low' | 'high' | 'max',
                })
              }
            >
              <option value="low">低</option>
              <option value="high">高</option>
              <option value="max">最高</option>
            </select>
          </Field>
        </div>
      )}
      <div className="field-grid">
        <Field
          label="Temperature"
          hint={thinking ? '思考模式下不生效，不会发送此参数。' : undefined}
        >
          <TextInput
            type="number"
            min="0"
            max="2"
            step="0.1"
            disabled={thinking}
            value={value.temperature ?? 0.7}
            onChange={(event) =>
              change({ temperature: Number(event.target.value) })
            }
          />
        </Field>
        <Field
          label="Max Tokens"
          hint={
            thinking
              ? '包含思考和正文；额度耗尽时不能直接应用结果。'
              : '限制本次生成的输出长度。'
          }
        >
          <TextInput
            type="number"
            min="1"
            max={providerTokenLimit(value)}
            value={value.maxTokens ?? (deepseek ? 8192 : 4000)}
            onChange={(event) =>
              change({ maxTokens: Number(event.target.value) })
            }
          />
        </Field>
      </div>
      <div className="field-grid">
        <Field label="等待时限（秒）">
          <TextInput
            type="number"
            min="30"
            max="600"
            value={value.timeoutSeconds ?? (deepseek ? 300 : 120)}
            onChange={(event) =>
              change({ timeoutSeconds: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="输出方式">
          <select
            className="select-input"
            value={(value.stream ?? deepseek) ? 'stream' : 'complete'}
            onChange={(event) =>
              change({ stream: event.target.value === 'stream' })
            }
          >
            <option value="stream">实时显示正文</option>
            <option value="complete">生成完成后显示</option>
          </select>
        </Field>
      </div>
      <p className="field-hint">
        输出仅在完整生成后可应用到正文。接收中可停止；修改或切换章节时仍保留原有冲突保护。
      </p>
    </fieldset>
  )
}
