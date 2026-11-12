import type { ProjectData,ProjectInput,Stats } from '../types'
import { command,isDesktop } from './transport'

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  available: boolean
  url: string
}
async function openProjectWithLease(path: string): Promise<ProjectData> {
  if (!isDesktop) return command<ProjectData>('open_project', { path })
  const result = await command<{ data: ProjectData; leaseToken: string }>(
    'prepare_open_project',
    { path },
    'desktopOnly',
  )
  return { ...result.data, leaseToken: result.leaseToken }
}

export const projectsApi = {
  release: (path: string, token?: string | null) =>
    isDesktop
      ? token
        ? command<void>('release_project_lease', { path, token }, 'desktopOnly')
        : command<void>('release_project', { path }, 'desktopOnly')
      : Promise.resolve(),
  retain: (path: string, token: string) =>
    command<void>('retain_project_lease', { path, token }, 'desktopOnly'),
  create: async (input: ProjectInput) => {
    const data = await command<ProjectData>('create_project', { input })
    return isDesktop ? openProjectWithLease(input.path) : data
  },
  open: openProjectWithLease,
  checkUpdates: () => command<UpdateInfo>('check_updates', {}, 'desktopOnly'),
  openExternalUrl: (url: string) =>
    command<void>('open_external_url', { url }, 'desktopOnly'),
  stats: (path: string, nodeId?: string) =>
    command<Stats>('get_statistics', {
      input: { projectPath: path, currentNodeId: nodeId },
    }),
  readLogs: (path: string) => command<string>('read_logs', { path }),
  updateProject: (input: {
    projectPath: string
    title: string
    author: string
    description: string
    genre: string
    targetWords: number
  }) => command<ProjectData>('update_project', { input }),
}
