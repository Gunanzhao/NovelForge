import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  DocumentData, EntityInput, EntityRecord, ExportInput, HistoryItem, NodeInput, ProjectData,
  ProjectInput, RecoveryItem, SaveDocumentInput, SearchInput, SearchResult, Stats, TrashItem,
} from './types'
import { fallbackInvoke } from './fallback'

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function command<T>(name: string, args: Record<string, unknown>, fallback = true) {
  if (isDesktop) return invoke<T>(name, args)
  if (fallback) return fallbackInvoke<T>(name, args)
  throw new Error('当前不是 Tauri 桌面运行环境。')
}

export function chooseDirectory() {
  if (!isDesktop) return Promise.resolve<string | null>(null)
  return open({ directory: true, multiple: false, title: '选择项目文件夹' }) as Promise<string | null>
}

export const projectApi = {
  create: (input: ProjectInput) => command<ProjectData>('create_project', { input }),
  open: (path: string) => command<ProjectData>('open_project', { path }),
  createNode: (input: NodeInput) => command<ProjectData>('create_node', { input }),
  renameNode: (input: { projectPath: string; nodeId: string; title: string }) => command<ProjectData>('rename_node', { input }),
  setNodeStatus: (input: { projectPath: string; nodeId: string; status: string }) => command<ProjectData>('set_node_status', { input }),
  reorderNode: (input: { projectPath: string; nodeId: string; direction: string }) => command<ProjectData>('reorder_node', { input }),
  deleteNode: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('delete_node', { input }),
  getDocument: (input: { projectPath: string; nodeId: string }) => command<DocumentData>('get_document', { input }),
  saveDocument: (input: SaveDocumentInput) => command<DocumentData>('save_document', { input }),
  listRecovery: (path: string) => command<RecoveryItem[]>('list_recovery', { path }),
  readRecovery: (input: { projectPath: string; recoveryId: string }) => command<string>('read_recovery', { input }),
  restoreRecovery: (input: { projectPath: string; recoveryId: string }) => command<ProjectData>('restore_recovery', { input }),
  discardRecovery: (input: { projectPath: string; recoveryId: string }) => command<RecoveryItem[]>('discard_recovery', { input }),
  listHistory: (input: { projectPath: string; nodeId: string }) => command<HistoryItem[]>('list_history', { input }),
  readHistory: (input: { projectPath: string; revisionId: string }) => command<string>('read_history', { input }),
  restoreHistory: (input: { projectPath: string; revisionId: string }) => command<ProjectData>('restore_history', { input }),
  upsertEntity: (input: EntityInput) => command<ProjectData>('upsert_entity', { input }),
  listEntities: (path: string, kind?: string) => command<EntityRecord[]>('list_entities', { path, kind }),
  deleteEntity: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('delete_entity', { input }),
  listTrash: (path: string) => command<TrashItem[]>('list_trash', { path }),
  restoreTrash: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('restore_trash', { input }),
  permanentDelete: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('permanent_delete', { input }),
  search: (input: SearchInput) => command<SearchResult[]>('search_project', { input }),
  stats: (path: string) => command<Stats>('get_statistics', { path }),
  exportProject: (input: ExportInput) => command<string>('export_project', { input }),
  updateProject: (input: { projectPath: string; title: string; author: string; description: string; genre: string; targetWords: number }) => command<ProjectData>('update_project', { input }),
}

export function getBrowserExportText(path: string) {
  return path.startsWith('browser://') ? '浏览器开发模式导出已记录；桌面模式会写入项目 .novelforge/exports。' : ''
}
