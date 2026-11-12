import type {
ConfirmedRevision,
RevisionChapter,
RevisionRound,
RevisionRoundView,
RevisionTarget,
} from '../revision-workbench'
import type { EntityState,ProjectData } from '../types'
import { command } from './transport'

export const revisionsApi = {
  revisionRounds: (path: string) =>
    command<RevisionRound[]>('list_revision_rounds', { path }, 'desktopOnly'),
  createRevisionRound: (input: {
    projectPath: string
    title: string
    nodeIds: string[]
  }) =>
    command<RevisionRoundView>(
      'create_revision_round',
      { input },
      'desktopOnly',
    ),
  openRevisionRound: (input: {
    projectPath: string
    roundId: string
    nodeId?: string
  }) =>
    command<RevisionRoundView>('open_revision_round', { input }, 'desktopOnly'),
  saveRevisionCandidate: (input: RevisionTarget, candidate: string) =>
    command<RevisionChapter>(
      'save_revision_candidate',
      { input, candidate },
      'desktopOnly',
    ),
  rebaseRevisionChapter: (input: RevisionTarget, seenContent: string) =>
    command<RevisionChapter>(
      'rebase_revision_chapter',
      { input, seenContent },
      'desktopOnly',
    ),
  confirmRevisionChapter: (input: RevisionTarget) =>
    command<ConfirmedRevision>(
      'confirm_revision_chapter',
      { input },
      'desktopOnly',
    ),
  confirmChapterMemory: (input: {
    projectPath: string
    entityId: string
    expected: EntityState
  }) => command<ProjectData>('confirm_chapter_memory', { input }),
}
