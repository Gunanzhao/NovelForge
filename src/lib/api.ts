import { projectsApi } from './api/projects'
import { manuscriptApi } from './api/manuscript'
import { revisionsApi } from './api/revisions'
import { recoveryApi } from './api/recovery'
import { entitiesApi } from './api/entities'
import { toolsApi } from './api/tools'

export { isDesktop, chooseDirectory, chooseFile } from './api/transport'
export type { UpdateInfo } from './api/projects'
export type { BackupReport } from './api/recovery'

// Stable facade for consumers and test doubles. Command policies live in each domain.
export const projectApi = {
  ...projectsApi,
  ...manuscriptApi,
  ...revisionsApi,
  ...recoveryApi,
  ...entitiesApi,
  ...toolsApi,
}

export function getBrowserExportText(path: string) {
  return path.startsWith('browser://')
    ? '浏览器开发模式导出已记录；桌面模式会写入项目 .novelforge/exports。'
    : ''
}
