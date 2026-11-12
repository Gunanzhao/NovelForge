import type {
  AiCompletionInput,
  AiCompletionResult,
  ConsistencyReport,
  ExportInput,
  ExportPreflight,
  SearchInput,
  SearchPage,
  SearchResult,
} from '../types'
import { command, isDesktop } from './transport'
import { Channel } from '@tauri-apps/api/core'
import type { AiProviderModel } from '../types'

export const toolsApi = {
  search: (input: SearchInput) =>
    command<SearchResult[]>('search_project', { input }),
  searchPage: (input: SearchInput, offset: number) =>
    command<SearchPage>('search_project_page', { input, offset }),
  consistency: (path: string) =>
    command<ConsistencyReport>('check_consistency', { path }),
  async aiComplete(
    input: AiCompletionInput,
    requestId?: string,
    onContent?: (content: string) => void,
  ) {
    let accepting = true
    const onEvent =
      isDesktop && input.stream ? new Channel<{ content: string }>() : undefined
    if (onEvent)
      onEvent.onmessage = (event) => {
        if (accepting) onContent?.(event.content)
      }
    try {
      return await command<AiCompletionResult>(
        onEvent ? 'ai_complete_stream' : 'ai_complete',
        {
          input,
          requestId: requestId ?? crypto.randomUUID(),
          ...(onEvent ? { onEvent } : {}),
        },
      )
    } finally {
      accepting = false
    }
  },
  aiModels: (endpoint: string, apiKey: string, providerKind?: string) =>
    command<AiProviderModel[]>(
      'ai_models',
      { endpoint, apiKey, providerKind },
      'desktopOnly',
    ),
  aiCancel: (requestId: string) =>
    isDesktop
      ? command<void>('ai_cancel', { requestId }, 'desktopOnly')
      : Promise.resolve(),
  exportProject: (input: ExportInput) =>
    command<string>('export_project', { input }),
  exportPreflight: (
    input: Pick<
      ExportInput,
      | 'projectPath'
      | 'scope'
      | 'volumePath'
      | 'nodeIds'
      | 'onlyFinal'
      | 'includeSections'
    >,
  ) =>
    command<ExportPreflight>('export_preflight', {
      input: { ...input, format: 'markdown' },
    }),
  openExportOutput: (
    projectPath: string,
    outputPath: string,
    folder: boolean,
  ) =>
    command<void>(
      'open_export_output',
      { projectPath, outputPath, folder },
      'desktopOnly',
    ),
}
