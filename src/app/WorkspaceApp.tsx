import { Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { AiAssistantView } from '../components/AiAssistantView'
import { BackupWorkspaceNotice } from '../components/BackupWorkspaceStatus'
import { CommandPalette } from '../components/CommandPalette'
import { ContextMenuProvider } from '../components/ContextMenu'
import { DocumentConflictDialog } from '../components/DocumentConflictDialog'
import { DraftSnapshotNotice } from '../components/DraftSnapshotRecovery'
import { ErrorBoundary } from '../components/ErrorBoundary'
import {
  ExportDialog,
  type ExportDialogPreset,
} from '../components/ExportDialog'
import { QuickInboxCapture } from '../components/InboxView'
import { Inspector } from '../components/Inspector'
import { OperationNotice } from '../components/OperationNotice'
import {
  NodeDialog,
  NodeTransferDialog,
  ProjectDialog,
} from '../components/ProjectDialogs'
import { QuickOpen } from '../components/QuickOpen'
import { Sidebar } from '../components/Sidebar'
import { ResizeHandle } from '../components/shell/ResizeHandle'
import { StatusBar } from '../components/shell/StatusBar'
import { TopBar } from '../components/shell/TopBar'
import { Welcome } from '../components/shell/Welcome'
import { IconButton } from '../components/ui'
import { runGuarded } from '../lib/draft-guard'
import type {
  ExportFormat,
  ExportInput,
  NodeKind,
  NodeRecord,
} from '../lib/types'
import { fitWorkspaceColumns } from '../lib/workspace-preferences'
import { useAiTask } from '../stores/ai-task'
import {
  captureProjectSession,
  isCurrentProjectSession,
  useAppStore,
  type ProjectSession,
} from '../stores/app-store'
import { WorkspaceView } from './WorkspaceView'
import { useWorkspaceContextMenus } from './hooks/useWorkspaceContextMenus'
import { useWorkspaceLifecycle } from './hooks/useWorkspaceLifecycle'

export function WorkspaceApp() {
  useWorkspaceLifecycle()
  const [backupRequest, setBackupRequest] = useState<ProjectSession | null>(
    null,
  )
  const openBackupSettings = useCallback(() => {
    const session = captureProjectSession()
    runGuarded(() => {
      if (!isCurrentProjectSession(session)) return
      setBackupRequest(session)
      useAppStore.getState().setView('settings')
    })
  }, [])
  const clearBackupRequest = useCallback(() => setBackupRequest(null), [])
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const data = useAppStore((state) => state.data)
  const activeView = useAppStore((state) => state.activeView)
  const document = useAppStore((state) => state.document)
  const annotationSession = useAppStore((state) => state.projectSession)
  const focusMode = useAppStore((state) => state.focusMode)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const inspectorOpen = useAppStore((state) => state.inspectorOpen)
  const workspacePreferences = useAppStore(
    (state) => state.workspacePreferences,
  )
  const inspectorRequested = useAppStore((state) => state.inspectorRequested)
  const inspectorTab = useAppStore((state) => state.inspectorTab)
  const setInspectorTab = useAppStore((state) => state.setInspectorTab)
  const error = useAppStore((state) => state.error)
  const closeProject = useAppStore((state) => state.closeProject)
  const toggleFocusMode = useAppStore((state) => state.toggleFocusMode)
  const setWorkspacePreferences = useAppStore(
    (state) => state.setWorkspacePreferences,
  )
  const clearError = useAppStore((state) => state.clearError)
  const [projectDialog, setProjectDialog] = useState<
    'new' | 'open' | 'import' | null
  >(null)
  const [exportPreset, setExportPreset] = useState<ExportDialogPreset | null>(
    null,
  )
  const [nodeDialog, setNodeDialog] = useState<{
    kind: NodeKind
    parentId: string | null
  } | null>(null)
  const [transferDialog, setTransferDialog] = useState<{
    mode: 'move' | 'copy'
    nodeId: string
  } | null>(null)
  const openQuickOpen = useCallback(
    () => window.dispatchEvent(new Event('novelforge:quick-open')),
    [],
  )

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        (viewportWidth < 1180 || focusMode) &&
        useAppStore.getState().inspectorTab === 'chapter' &&
        !globalThis.document.querySelector('[role="dialog"]')
      ) {
        useAppStore.setState({ inspectorRequested: false })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [viewportWidth, focusMode])

  function exportProject(
    format: ExportFormat,
    options: Omit<ExportInput, 'projectPath' | 'format'>,
  ) {
    return useAppStore.getState().exportProject(format, options)
  }

  const { pluginItems, fallbackItems } = useWorkspaceContextMenus(
    setProjectDialog,
    openQuickOpen,
  )

  const openExportForNode = useCallback((node: NodeRecord) => {
    if (node.kind === 'volume')
      setExportPreset({ scope: 'volume', volumePath: node.filePath })
    if (node.kind === 'chapter')
      setExportPreset({ scope: 'chapters', nodeIds: [node.id] })
  }, [])

  if (!data)
    return (
      <ContextMenuProvider
        fallbackItems={fallbackItems}
        pluginItems={pluginItems}
      >
        <>
          <Welcome onProject={setProjectDialog} />
          <CommandPalette
            onNewProject={() => setProjectDialog('new')}
            onCloseProject={() => void closeProject()}
            onQuickOpen={() => undefined}
          />
          <ProjectDialog
            mode={projectDialog}
            onClose={() => setProjectDialog(null)}
          />
          {error && !error.startsWith('EXTERNAL_CONFLICT:') ? (
            <div className="toast-error" role="alert">
              <Undo2 size={15} />
              {error}
              <button onClick={clearError}>×</button>
            </div>
          ) : null}
        </>
      </ContextMenuProvider>
    )
  const compactInspector = viewportWidth < 1180 || focusMode
  const inspectorVisible =
    inspectorOpen &&
    activeView === 'manuscript' &&
    (!compactInspector || inspectorRequested)
  const dismissInspector = () =>
    useAppStore.setState({
      inspectorRequested: false,
      ...(compactInspector ? {} : { inspectorOpen: false }),
    })
  const toggleInspector = () =>
    compactInspector
      ? useAppStore.setState({
          inspectorOpen: true,
          inspectorRequested: !inspectorVisible,
        })
      : useAppStore.getState().toggleInspector()
  const chapterDrawer =
    inspectorVisible && compactInspector && inspectorTab === 'chapter'
  const inlineAi = inspectorVisible && inspectorTab === 'ai'
  const aiDrawer = inlineAi && (focusMode || viewportWidth < 1180)
  const columns = fitWorkspaceColumns(
    workspacePreferences,
    viewportWidth,
    sidebarOpen && !focusMode,
    inspectorVisible && !compactInspector,
  )
  const inspectorTabs = (
    <div className="inspector-tabs" role="tablist" aria-label="正文辅助面板">
      <button
        role="tab"
        aria-selected={inspectorTab === 'chapter'}
        onClick={() => setInspectorTab('chapter')}
      >
        章节信息
      </button>
      <button
        role="tab"
        aria-selected={inspectorTab === 'ai'}
        onClick={() =>
          useAiTask.getState().id
            ? setInspectorTab('ai')
            : useAppStore.getState().openEditorAi()
        }
      >
        AI 辅助
      </button>
    </div>
  )
  const layoutStyle = {
    '--sidebar-width': String(columns.sidebar) + 'px',
    '--inspector-width': String(columns.inspector) + 'px',
    '--editor-font-family':
      workspacePreferences.editorFontFamily === 'sans'
        ? '"Noto Sans SC", "Microsoft YaHei UI", sans-serif'
        : '"Noto Serif SC", "Source Han Serif SC", Georgia, serif',
    '--editor-font-size': String(workspacePreferences.editorFontSize) + 'px',
    '--editor-line-height': String(workspacePreferences.editorLineHeight),
    '--content-width': String(workspacePreferences.contentWidth) + 'px',
    '--paragraph-spacing': String(workspacePreferences.paragraphSpacing) + 'px',
  } as CSSProperties
  const transferNode = transferDialog
    ? (data.nodes.find((node) => node.id === transferDialog.nodeId) ?? null)
    : null
  return (
    <ContextMenuProvider
      fallbackItems={fallbackItems}
      pluginItems={pluginItems}
    >
      <div className={'app-shell' + (focusMode ? ' focus-mode' : '')}>
        {focusMode && (activeView !== 'manuscript' || !document) ? (
          <button className="studio-exit-focus" onClick={toggleFocusMode}>
            退出专注模式 <kbd>F11</kbd>
          </button>
        ) : null}
        <OperationNotice />
        <DraftSnapshotNotice />
        <QuickInboxCapture />
        <DocumentConflictDialog />
        {focusMode ? null : (
          <TopBar
            inspectorVisible={inspectorVisible}
            onInspectorToggle={toggleInspector}
            onProject={setProjectDialog}
            onExport={() => setExportPreset({ scope: 'project' })}
            onCloseProject={() => void closeProject()}
          />
        )}
        <BackupWorkspaceNotice
          key={annotationSession}
          hidden={focusMode || activeView === 'settings'}
          onSettings={openBackupSettings}
        />
        <div
          className={
            'main-layout' +
            (focusMode ? ' sidebar-closed inspector-closed' : '') +
            (sidebarOpen ? '' : ' sidebar-closed') +
            (inspectorVisible && !compactInspector ? '' : ' inspector-closed')
          }
          style={layoutStyle}
        >
          <div className="sidebar-region" inert={!sidebarOpen || focusMode}>
            <Sidebar
              onAddNode={(kind, parentId) => setNodeDialog({ kind, parentId })}
              onMoveNode={(node) =>
                node.kind !== 'volume' &&
                setTransferDialog({ mode: 'move', nodeId: node.id })
              }
              onCopyNode={(node) =>
                setTransferDialog({ mode: 'copy', nodeId: node.id })
              }
              onExportNode={openExportForNode}
            />
            <ResizeHandle
              side="sidebar"
              width={columns.sidebar}
              onResize={(width) =>
                setWorkspacePreferences({ sidebarWidth: width })
              }
            />
          </div>
          <main className="workspace" hidden={activeView === 'ai'}>
            <ErrorBoundary key={activeView} label="当前视图">
              <WorkspaceView
                backupRequest={backupRequest}
                clearBackupRequest={clearBackupRequest}
              />
            </ErrorBoundary>
          </main>
          <div
            className={
              'inspector-region' + (chapterDrawer ? ' inspector-drawer' : '')
            }
            hidden={inlineAi || !inspectorVisible}
            inert={!inspectorVisible}
          >
            {chapterDrawer ? (
              <div className="drawer-heading">
                <strong>章节辅助</strong>
                <IconButton
                  icon={X}
                  label="关闭章节辅助"
                  onClick={dismissInspector}
                />
              </div>
            ) : null}
            {inspectorTabs}
            <ErrorBoundary label="章节辅助栏">
              <Inspector />
            </ErrorBoundary>
            <ResizeHandle
              side="inspector"
              width={columns.inspector}
              onResize={(width) =>
                setWorkspacePreferences({ inspectorWidth: width })
              }
            />
          </div>
          <div
            className={
              'ai-host ' +
              (activeView === 'ai'
                ? 'ai-host-full'
                : aiDrawer
                  ? 'ai-host-drawer'
                  : 'ai-host-inline')
            }
            hidden={activeView !== 'ai' && !inlineAi}
            inert={activeView !== 'ai' && !inlineAi}
          >
            {activeView !== 'ai' ? inspectorTabs : null}
            <ErrorBoundary label="AI 辅助">
              <AiAssistantView
                compact={activeView !== 'ai'}
                visible={activeView === 'ai' || inlineAi}
                onExpand={() => useAppStore.getState().setView('ai')}
                onDismiss={dismissInspector}
              />
            </ErrorBoundary>
            {inlineAi && !aiDrawer ? (
              <ResizeHandle
                side="inspector"
                width={columns.inspector}
                onResize={(width) =>
                  setWorkspacePreferences({ inspectorWidth: width })
                }
              />
            ) : null}
          </div>
        </div>
        {focusMode ? null : <StatusBar onBackupSettings={openBackupSettings} />}
        <CommandPalette
          onNewProject={() => setProjectDialog('new')}
          onCloseProject={() => void closeProject()}
          onQuickOpen={openQuickOpen}
        />
        <QuickOpen />
        <ExportDialog
          open={Boolean(exportPreset)}
          preset={exportPreset ?? undefined}
          onClose={() => setExportPreset(null)}
          data={data}
          currentNodeId={document?.node.id}
          onExport={exportProject}
        />
        <ProjectDialog
          mode={projectDialog}
          onClose={() => setProjectDialog(null)}
        />
        <NodeDialog
          kind={nodeDialog?.kind ?? null}
          parentId={nodeDialog?.parentId ?? null}
          onClose={() => setNodeDialog(null)}
        />
        <NodeTransferDialog
          mode={transferDialog?.mode ?? null}
          node={transferNode}
          data={data}
          onClose={() => setTransferDialog(null)}
          onSubmit={async (targetParentId, title) => {
            if (!transferDialog) return
            if (transferDialog.mode === 'move')
              await useAppStore
                .getState()
                .moveNode(transferDialog.nodeId, targetParentId)
            else
              await useAppStore
                .getState()
                .copyNode(transferDialog.nodeId, targetParentId, title)
          }}
        />
        {error && !error.startsWith('EXTERNAL_CONFLICT:') ? (
          <div className="toast-error" role="alert">
            <Undo2 size={15} />
            {error}
            <button onClick={clearError}>×</button>
          </div>
        ) : null}
      </div>
    </ContextMenuProvider>
  )
}
