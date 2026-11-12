import { AnnotationTasks } from '../components/AnnotationTasks'
import { AttachmentsView } from '../components/AttachmentsView'
import { ChapterMemoryView } from '../components/ChapterMemoryView'
import { CharacterStatisticsView } from '../components/CharacterAppearance'
import { ConsistencyView } from '../components/ConsistencyView'
import { Dashboard } from '../components/Dashboard'
import { EditorPane } from '../components/EditorPane'
import { EntityView } from '../components/EntityView'
import { ForeshadowingView } from '../components/ForeshadowingView'
import { InboxView } from '../components/InboxView'
import { ManuscriptImportView } from '../components/ManuscriptImportView'
import { PlanningView } from '../components/PlanningView'
import { RelationshipsView } from '../components/RelationshipsView'
import { RevisionWorkbench } from '../components/RevisionWorkbench'
import { SearchView } from '../components/SearchView'
import { SettingsView } from '../components/SettingsView'
import { StatisticsView } from '../components/StatisticsView'
import { StoryArcView } from '../components/StoryArcView'
import { TimelineView } from '../components/TimelineView'
import { TrashView } from '../components/TrashView'
import {
  isCurrentProjectSession,
  useAppStore,
  type ProjectSession,
} from '../stores/app-store'

export function WorkspaceView({
  backupRequest,
  clearBackupRequest,
}: {
  backupRequest: ProjectSession | null
  clearBackupRequest: () => void
}) {
  const data = useAppStore((state) => state.data)
  const activeView = useAppStore((state) => state.activeView)
  if (!data) return null
  if (activeView === 'manuscript-import') return <ManuscriptImportView />
  if (activeView === 'revision-workbench') return <RevisionWorkbench />
  if (activeView === 'chapter-memory') return <ChapterMemoryView />
  if (activeView === 'annotation') return <AnnotationTasks />
  if (activeView === 'dashboard') return <Dashboard />
  if (activeView === 'manuscript') return <EditorPane />
  if (activeView === 'outline') return <PlanningView />
  if (activeView === 'timeline') return <TimelineView />
  if (activeView === 'foreshadowing') return <ForeshadowingView />
  if (activeView === 'relationship') return <RelationshipsView />
  if (activeView === 'consistency') return <ConsistencyView />
  if (activeView === 'statistics') return <StatisticsView />
  if (activeView === 'story-arc') return <StoryArcView />
  if (activeView === 'character-statistics') return <CharacterStatisticsView />
  if (activeView === 'inbox') return <InboxView />
  if (activeView === 'attachment') return <AttachmentsView />
  if (activeView === 'ai') return <EditorPane />
  if (activeView === 'search') return <SearchView />
  if (activeView === 'trash') return <TrashView />
  if (activeView === 'settings')
    return (
      <SettingsView
        openBackup={Boolean(
          backupRequest && isCurrentProjectSession(backupRequest),
        )}
        onBackupOpened={clearBackupRequest}
      />
    )
  return <EntityView kind={activeView} />
}
