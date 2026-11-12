import type {
EntityInput,
EntityRecord,
EntityState,
EntityVersion,
ProjectData,
} from '../types'
import type { RenameChanges,WikiRenameOperation } from '../wiki-rename'
import { command } from './transport'

export const entitiesApi = {
  applyWikiRename: (input: {
    projectPath: string
    targetId: string
    changes: RenameChanges
  }) =>
    command<{ data: ProjectData; operationId: string }>('apply_wiki_rename', {
      input,
    }),
  undoWikiRename: (input: { projectPath: string; operationId: string }) =>
    command<{ data: ProjectData; operationId: string }>('undo_wiki_rename', {
      input,
    }),
  listWikiRenames: (input: { projectPath: string; targetId: string }) =>
    command<WikiRenameOperation[]>('list_wiki_renames', { input }),
  upsertEntity: (input: EntityInput, expected?: EntityState) =>
    command<ProjectData>(expected ? 'upsert_entity_checked' : 'upsert_entity', {
      input,
      ...(expected ? { expected } : {}),
    }),
  listEntityHistory: (input: {
    projectPath: string
    entityId: string
    beforeId?: string
  }) => command<EntityVersion[]>('list_entity_history', { input }),
  nameEntityVersion: (input: {
    projectPath: string
    entityId: string
    name: string
    expected: EntityState
  }) => command<void>('name_entity_version', { input }),
  restoreEntityVersion: (input: {
    projectPath: string
    entityId: string
    versionId: string
    fields?: string[]
    expected: EntityState
  }) => command<ProjectData>('restore_entity_version', { input }),
  listEntities: (path: string, kind?: string) =>
    command<EntityRecord[]>('list_entities', { path, kind }),
  deleteEntity: (input: { projectPath: string; nodeId: string }) =>
    command<ProjectData>('delete_entity', { input }),
  importAttachment: (input: {
    projectPath: string
    sourcePath: string
    description: string
  }) => command<ProjectData>('import_attachment', { input }),
  openAttachment: (input: { projectPath: string; nodeId: string }) =>
    command<string>('open_attachment', { input }),
}
