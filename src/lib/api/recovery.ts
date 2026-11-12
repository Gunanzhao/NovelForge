import type { AutoBackupStatus } from '../auto-backup-types'
import type {
HistoryItem,
ProjectData,
RecoveryItem,
TrashItem,
} from '../types'
import { command } from './transport'

export interface BackupReport {
  path: string
  fileCount: number
  totalBytes: number
}

export const recoveryApi = {
  autoBackupStatus: (path: string) =>
    command<AutoBackupStatus>('auto_backup_status', { path }, 'desktopOnly'),
  configureAutoBackup: (input: {
    projectPath: string
    enabled: boolean
    directory: string
    trigger: 'daily' | 'session'
    keep: number
  }) =>
    command<AutoBackupStatus>(
      'configure_auto_backup',
      { input },
      'desktopOnly',
    ),
  runAutoBackup: (input: { projectPath: string; manual: boolean }) =>
    command<AutoBackupStatus>('run_auto_backup', { input }, 'desktopOnly'),
  cleanupAutoBackups: (input: { projectPath: string; archiveIds: string[] }) =>
    command<AutoBackupStatus>('cleanup_auto_backups', { input }, 'desktopOnly'),
  backup: (path: string, directory: string) =>
    command<BackupReport>('backup_project', { path, directory }, 'desktopOnly'),
  validateBackup: (path: string) =>
    command<BackupReport>('validate_backup', { path }, 'desktopOnly'),
  restoreBackup: (path: string, directory: string) =>
    command<BackupReport>('restore_backup', { path, directory }, 'desktopOnly'),
  listRecovery: (path: string) =>
    command<RecoveryItem[]>('list_recovery', { path }),
  recoveryAsChapter: (input: {
    projectPath: string
    recoveryId: string
    expectedContent: string
    parentId: string
    title: string
    requestId: string
  }) => command<ProjectData>('recovery_as_chapter', { input }, 'desktopOnly'),
  readRecovery: (input: { projectPath: string; recoveryId: string }) =>
    command<string>('read_recovery', { input }),
  restoreRecovery: (input: { projectPath: string; recoveryId: string }) =>
    command<ProjectData>('restore_recovery', { input }),
  discardRecovery: (input: { projectPath: string; recoveryId: string }) =>
    command<RecoveryItem[]>('discard_recovery', { input }),
  createHistorySnapshot: (input: {
    projectPath: string
    nodeId: string
    content: string
    kind: 'automatic' | 'checkpoint' | 'named' | 'protected'
    name?: string
  }) => command<void>('create_history_snapshot', { input }),
  listHistoryPage: (input: {
    projectPath: string
    nodeId: string
    before?: string
    filter: string
  }) => command<HistoryItem[]>('list_history_page', { input }),
  listHistory: (input: { projectPath: string; nodeId: string }) =>
    command<HistoryItem[]>('list_history', { input }),
  readHistory: (input: { projectPath: string; revisionId: string }) =>
    command<string>('read_history', { input }),
  restoreHistory: (input: {
    projectPath: string
    revisionId: string
    expectedNodeId: string
  }) => command<ProjectData>('restore_history', { input }),
  listTrash: (path: string) => command<TrashItem[]>('list_trash', { path }),
  emptyTrash: (path: string) => command<ProjectData>('empty_trash', { path }),
  restoreTrash: (input: { projectPath: string; nodeId: string }) =>
    command<ProjectData>('restore_trash', { input }),
  permanentDelete: (input: { projectPath: string; nodeId: string }) =>
    command<ProjectData>('permanent_delete', { input }),
}
