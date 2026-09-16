import type { AutoBackupStatus } from './auto-backup-types'
import type { RenameChanges, WikiRenameOperation } from './wiki-rename'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  EntityState, EntityVersion, AiCompletionInput, AiCompletionResult, ConsistencyReport, CopyNodeInput, DocumentData, EntityInput, EntityRecord, ExportInput, HistoryItem, MoveNodeInput, NodeInput, ProjectData,
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

export function chooseFile() {
  if (!isDesktop) return Promise.resolve<string | null>(null)
  return open({ directory: false, multiple: false, title: '选择要导入的附件' }) as Promise<string | null>
}

export interface BackupReport { path: string; fileCount: number; totalBytes: number }
export interface UpdateInfo { currentVersion: string; latestVersion: string; available: boolean; url: string }
async function openProjectWithLease(path: string): Promise<ProjectData> {
  if (!isDesktop) return command<ProjectData>('open_project', { path })
  const result = await command<{ data: ProjectData; leaseToken: string }>('prepare_open_project', { path }, false)
  return { ...result.data, leaseToken: result.leaseToken }
}
export const projectApi = {
  autoBackupStatus: (path:string) => command<AutoBackupStatus>('auto_backup_status',{path},false),
  configureAutoBackup: (input:{projectPath:string;enabled:boolean;directory:string;trigger:'daily'|'session';keep:number}) => command<AutoBackupStatus>('configure_auto_backup',{input},false),
  runAutoBackup: (input:{projectPath:string;manual:boolean}) => command<AutoBackupStatus>('run_auto_backup',{input},false),
  cleanupAutoBackups: (input:{projectPath:string;archiveIds:string[]}) => command<AutoBackupStatus>('cleanup_auto_backups',{input},false),
  applyWikiRename: (input: { projectPath: string; targetId: string; changes: RenameChanges }) => command<{data: ProjectData; operationId: string}>('apply_wiki_rename', {input}),
  undoWikiRename: (input: { projectPath: string; operationId: string }) => command<{data: ProjectData; operationId: string}>('undo_wiki_rename', {input}),
  listWikiRenames: (input: { projectPath: string; targetId: string }) => command<WikiRenameOperation[]>('list_wiki_renames', {input}),
  checkUpdates: () => command<UpdateInfo>('check_updates', {}, false),
  backup: (path: string, directory: string) => command<BackupReport>('backup_project', { path, directory }, false),
  validateBackup: (path: string) => command<BackupReport>('validate_backup', { path }, false),
  restoreBackup: (path: string, directory: string) => command<BackupReport>('restore_backup', { path, directory }, false),
  openExternalUrl: (url: string) => command<void>('open_external_url', { url }, false),
  release: (path: string, token?: string | null) => isDesktop ? (token ? command<void>('release_project_lease', { path, token }, false) : command<void>('release_project', { path }, false)) : Promise.resolve(),
  retain: (path: string, token: string) => command<void>('retain_project_lease', { path, token }, false),
  create: async (input: ProjectInput) => { const data = await command<ProjectData>('create_project', { input }); return isDesktop ? openProjectWithLease(input.path) : data },
  open: openProjectWithLease,
  createNode: (input: NodeInput) => command<ProjectData>('create_node', { input }),
  renameNode: async (input: { projectPath: string; nodeId: string; title: string; expectedContent?: string }): Promise<ProjectData & { renamedDocument?: DocumentData }> => {
    if (!isDesktop) {
      const data = await command<ProjectData>('rename_node', { input })
      const renamedDocument = data.nodes.find(node => node.id === input.nodeId)?.kind !== 'volume'
        ? await command<DocumentData>('get_document', { input }) : undefined
      return { ...data, renamedDocument }
    }
    const result = await command<{ data: ProjectData; document: DocumentData | null }>('rename_node_checked', { input, expectedContent: input.expectedContent }, false)
    return { ...result.data, renamedDocument: result.document ?? undefined }
  },
  setNodeStatus: (input: { projectPath: string; nodeId: string; status: string }) => command<ProjectData>('set_node_status', { input }),
  reorderNode: (input: { projectPath: string; nodeId: string; direction: string }) => command<ProjectData>('reorder_node', { input }),
  moveNode: (input: MoveNodeInput) => command<ProjectData>('move_node', { input }),
  copyNode: (input: CopyNodeInput) => command<ProjectData>('copy_node', { input }),
  deleteNode: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('delete_node', { input }),
  getDocument: (input: { projectPath: string; nodeId: string }) => command<DocumentData>('get_document', { input }),
  saveDocument: (input: SaveDocumentInput & { expectedContent?: string }) => isDesktop
    ? command<DocumentData>('save_document_checked', { input, expectedContent: input.expectedContent ?? input.content }, false)
    : command<DocumentData>('save_document', { input }),
  listRecovery: (path: string) => command<RecoveryItem[]>('list_recovery', { path }),
  recoveryAsChapter: (input:{projectPath:string;recoveryId:string;expectedContent:string;parentId:string;title:string;requestId:string}) => command<ProjectData>('recovery_as_chapter',{input},false),
  readRecovery: (input: { projectPath: string; recoveryId: string }) => command<string>('read_recovery', { input }),
  restoreRecovery: (input: { projectPath: string; recoveryId: string }) => command<ProjectData>('restore_recovery', { input }),
  discardRecovery: (input: { projectPath: string; recoveryId: string }) => command<RecoveryItem[]>('discard_recovery', { input }),
  createHistorySnapshot: (input: { projectPath: string; nodeId: string; content: string; kind: 'automatic' | 'checkpoint' | 'named' | 'protected'; name?: string }) => command<void>('create_history_snapshot', { input }),
  listHistoryPage: (input: { projectPath: string; nodeId: string; before?: string; filter: string }) => command<HistoryItem[]>('list_history_page', { input }),
  listHistory: (input: { projectPath: string; nodeId: string }) => command<HistoryItem[]>('list_history', { input }),
  readHistory: (input: { projectPath: string; revisionId: string }) => command<string>('read_history', { input }),
  restoreHistory: (input: { projectPath: string; revisionId: string; expectedNodeId: string }) => command<ProjectData>('restore_history', { input }),
  upsertEntity: (input: EntityInput, expected?: EntityState) => command<ProjectData>(expected ? 'upsert_entity_checked' : 'upsert_entity', { input, ...(expected ? { expected } : {}) }),
  listEntityHistory: (input: { projectPath: string; entityId: string; beforeId?: string }) => command<EntityVersion[]>('list_entity_history', { input }),
  nameEntityVersion: (input: { projectPath: string; entityId: string; name: string; expected: EntityState }) => command<void>('name_entity_version', { input }),
  restoreEntityVersion: (input: { projectPath: string; entityId: string; versionId: string; fields?: string[]; expected: EntityState }) => command<ProjectData>('restore_entity_version', { input }),
  listEntities: (path: string, kind?: string) => command<EntityRecord[]>('list_entities', { path, kind }),
  deleteEntity: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('delete_entity', { input }),
  listTrash: (path: string) => command<TrashItem[]>('list_trash', { path }),
  emptyTrash: (path: string) => command<ProjectData>('empty_trash', { path }),
  restoreTrash: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('restore_trash', { input }),
  permanentDelete: (input: { projectPath: string; nodeId: string }) => command<ProjectData>('permanent_delete', { input }),
  search: (input: SearchInput) => command<SearchResult[]>('search_project', { input }),
  consistency: (path: string) => command<ConsistencyReport>('check_consistency', { path }),
  aiComplete: (input: AiCompletionInput, requestId?: string) => command<AiCompletionResult>('ai_complete', { input, requestId: requestId ?? crypto.randomUUID() }),
  aiCancel: (requestId: string) => isDesktop ? command<void>('ai_cancel', { requestId }, false) : Promise.resolve(),
  importAttachment: (input: { projectPath: string; sourcePath: string; description: string }) => command<ProjectData>('import_attachment', { input }),
  openAttachment: (input: { projectPath: string; nodeId: string }) => command<string>('open_attachment', { input }),
  stats: (path: string, nodeId?: string) => command<Stats>('get_statistics', { input: { projectPath: path, currentNodeId: nodeId } }),
  exportProject: (input: ExportInput) => command<string>('export_project', { input }),
  readLogs: (path: string) => command<string>('read_logs', { path }),
  updateProject: (input: { projectPath: string; title: string; author: string; description: string; genre: string; targetWords: number }) => command<ProjectData>('update_project', { input }),
}

export function getBrowserExportText(path: string) {
  return path.startsWith('browser://') ? '浏览器开发模式导出已记录；桌面模式会写入项目 .novelforge/exports。' : ''
}
