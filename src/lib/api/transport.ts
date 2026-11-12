import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { fallbackInvoke } from '../fallback'

export const isDesktop =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function command<T>(
  name: string,
  args: Record<string, unknown>,
  transport: 'demoAllowed' | 'desktopOnly' = 'demoAllowed',
) {
  if (isDesktop) return invoke<T>(name, args)
  if (transport === 'demoAllowed') return fallbackInvoke<T>(name, args)
  throw new Error('当前不是 Tauri 桌面运行环境。')
}

export function chooseDirectory(title = '选择项目文件夹') {
  if (!isDesktop) return Promise.resolve<string | null>(null)
  return open({ directory: true, multiple: false, title }) as Promise<
    string | null
  >
}

export function chooseFile({
  title = '选择要导入的附件',
  filters,
}: {
  title?: string
  filters?: { name: string; extensions: string[] }[]
} = {}) {
  if (!isDesktop) return Promise.resolve<string | null>(null)
  return open({ directory: false, multiple: false, title, filters }) as Promise<
    string | null
  >
}
