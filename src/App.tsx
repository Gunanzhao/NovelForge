import { useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  BookOpen, Check, FileDown, FolderOpen, Menu, Moon, PanelRight, Plus, Search,
  Settings, Sun, Undo2, X,
} from 'lucide-react'
import { isDesktop } from './lib/api'
import type { ExportFormat, ExportInput, NodeKind } from './lib/types'
import { useAppStore } from './stores/app-store'
import { Dashboard } from './components/Dashboard'
import { CommandPalette } from './components/CommandPalette'
import { ConsistencyView } from './components/ConsistencyView'
import { ExportDialog } from './components/ExportDialog'
import { EditorPane } from './components/EditorPane'
import { PlanningView } from './components/PlanningView'
import { TimelineView } from './components/TimelineView'
import { ForeshadowingView } from './components/ForeshadowingView'
import { AttachmentsView } from './components/AttachmentsView'
import { AiAssistantView } from './components/AiAssistantView'
import { EntityView } from './components/EntityView'
import { Inspector } from './components/Inspector'
import { NodeTransferDialog, ProjectDialog, NodeDialog } from './components/ProjectDialogs'
import { SearchView } from './components/SearchView'
import { SettingsView } from './components/SettingsView'
import { RelationshipsView } from './components/RelationshipsView'
import { StatisticsView } from './components/StatisticsView'
import { Sidebar } from './components/Sidebar'
import { TrashView } from './components/TrashView'
import { QuickOpen } from './components/QuickOpen'
import { Button, IconButton } from './components/ui'
import { formatNumber } from './lib/utils'

function Welcome({ onProject }: { onProject: (mode: 'new' | 'open') => void }) {
  const recentProjects = useAppStore((state) => state.recentProjects)
  const openProject = useAppStore((state) => state.openProject)
  const setError = useAppStore((state) => state.setError)
  return <div className="welcome"><div className="welcome-card"><div className="welcome-title"><span className="brand-mark">N</span><div><h1>NovelForge</h1><p>本地优先的中文长篇小说创作工作台</p></div></div><p className="welcome-copy">把正文、人物、地点和世界观放在一个安静的工作台里。正文始终是普通 Markdown 文件，SQLite 只负责资料与搜索索引；没有账号、没有 API Key，也可以完整写作。</p><div className="welcome-actions"><Button onClick={() => onProject('new')}><Plus size={15} />新建小说</Button><Button variant="outline" onClick={() => onProject('open')}><FolderOpen size={15} />打开项目</Button></div>{recentProjects.length ? <><p className="eyebrow">RECENT PROJECTS</p><div className="recent-projects">{recentProjects.map((project) => <button className="recent-project" key={project.path} onClick={() => void openProject(project.path).catch(setError)}><BookOpen size={16} /><span><strong>{project.title}</strong><small>{project.path}</small></span></button>)}</div></> : <div className="panel empty-state"><BookOpen size={25} /><div><strong>从一部小说开始</strong><span>选择一个空文件夹，NovelForge 会创建 project.json、Markdown 正文和 .novelforge 数据目录。</span></div></div>}</div></div>
}

function ResizeHandle({ side, width, onResize }: { side: 'sidebar' | 'inspector'; width: number; onResize: (width: number) => void }) {
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const origin = event.clientX
    const initial = width
    const update = (move: PointerEvent) => {
      const delta = side === 'sidebar' ? move.clientX - origin : origin - move.clientX
      onResize(initial + delta)
    }
    const finish = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish, { once: true })
  }
  function nudge(event: ReactKeyboardEvent<HTMLDivElement>) {
    const delta = event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0
    if (!delta) return
    event.preventDefault()
    onResize(width + (side === 'sidebar' ? delta : -delta))
  }
  return <div className={'panel-resize-handle ' + side} role="separator" aria-orientation="vertical" aria-label={side === 'sidebar' ? '调整左栏宽度' : '调整辅助栏宽度'} tabIndex={0} onPointerDown={startResize} onKeyDown={nudge} />
}

function TopBar({ onProject, onExport, onCloseProject }: { onProject: (mode: 'new' | 'open') => void; onExport: () => void; onCloseProject: () => void }) {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveState = useAppStore((state) => state.saveState)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const inspectorOpen = useAppStore((state) => state.inspectorOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const toggleInspector = useAppStore((state) => state.toggleInspector)
  const saveCurrentDocument = useAppStore((state) => state.saveCurrentDocument)
  const setView = useAppStore((state) => state.setView)
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)

  return <header className="topbar"><IconButton icon={Menu} label={sidebarOpen ? '收起左栏' : '展开左栏'} onClick={toggleSidebar} /><div className="brand"><span className="brand-mark">N</span><span className="brand-name">NovelForge</span><span className="brand-subtitle">写作工作台</span></div><div className="topbar-title"><strong>{data?.project.title ?? '未打开项目'}</strong><span>{projectPath ?? '本地优先 · Markdown first'}</span></div><div className="topbar-actions"><Button variant="ghost" onClick={() => onProject('new')}><Plus size={14} />新建</Button><Button variant="ghost" onClick={() => onProject('open')}><FolderOpen size={14} />打开</Button>{data ? <><span className="topbar-divider" /><Button variant="ghost" onClick={() => void saveCurrentDocument('手动保存')}><Check size={14} color={saveState === 'saved' ? 'var(--green)' : undefined} />保存</Button><Button variant="ghost" onClick={() => setView('search')}><Search size={14} />搜索</Button><Button variant="ghost" onClick={onExport}><FileDown size={14} />导出</Button><Button variant="ghost" onClick={onCloseProject}><X size={14} />关闭</Button><span className="topbar-divider" /><IconButton icon={sidebarOpen ? Menu : PanelRight} label="切换左栏" onClick={toggleSidebar} className={sidebarOpen ? 'active' : ''} /><IconButton icon={PanelRight} label={inspectorOpen ? '收起辅助栏' : '展开辅助栏'} onClick={toggleInspector} className={inspectorOpen ? 'active' : ''} /><IconButton icon={theme === 'dark' ? Sun : Moon} label="切换主题" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} /><IconButton icon={Settings} label="项目设置" onClick={() => setView('settings')} /></> : null}</div></header>
}

function StatusBar() {
  const document = useAppStore((state) => state.document)
  const stats = useAppStore((state) => state.stats)
  const saveState = useAppStore((state) => state.saveState)
  const toggleFocusMode = useAppStore((state) => state.toggleFocusMode)
  return <footer className="statusbar"><span>{document ? <><BookOpen size={12} />{document.node.title}</> : '未选择章节'}</span><span>{document ? formatNumber([...document.content].filter((character) => !/\s/u.test(character)).length) + ' 字' : '0 字'}</span><span>今日 +{formatNumber(stats.todayWords)}</span><span className="status-spacer" /><span className={'save-indicator ' + saveState}>{saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败' : saveState === 'saved' ? '已保存' : document ? '有未保存修改' : '就绪'}</span><button className="status-focus" onClick={toggleFocusMode}>F11 专注模式</button></footer>
}

export default function App() {
  const data = useAppStore((state) => state.data)
  const activeView = useAppStore((state) => state.activeView)
  const document = useAppStore((state) => state.document)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveState = useAppStore((state) => state.saveState)
  const focusMode = useAppStore((state) => state.focusMode)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const inspectorOpen = useAppStore((state) => state.inspectorOpen)
  const theme = useAppStore((state) => state.theme)
  const workspacePreferences = useAppStore((state) => state.workspacePreferences)
  const error = useAppStore((state) => state.error)
  const loadRecent = useAppStore((state) => state.loadRecent)
  const saveCurrentDocument = useAppStore((state) => state.saveCurrentDocument)
  const closeProject = useAppStore((state) => state.closeProject)
  const setWorkspacePreferences = useAppStore((state) => state.setWorkspacePreferences)
  const clearError = useAppStore((state) => state.clearError)
  const refreshStats = useAppStore((state) => state.refreshStats)
  const [projectDialog, setProjectDialog] = useState<'new' | 'open' | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [nodeDialog, setNodeDialog] = useState<{ kind: NodeKind; parentId: string | null } | null>(null)
  const [transferDialog, setTransferDialog] = useState<{ mode: 'move' | 'copy'; nodeId: string } | null>(null)
  const openQuickOpen = () => window.dispatchEvent(new Event('novelforge:quick-open'))

  useEffect(() => { loadRecent() }, [loadRecent])

  useEffect(() => {
    const applyTheme = () => {
      const resolved = theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : theme === 'system' ? 'light' : theme
      globalThis.document.documentElement.dataset.theme = resolved
    }
    applyTheme()
  }, [theme])

  useEffect(() => {
    if (saveState !== 'idle' || !document || !projectPath) return
    const timer = window.setTimeout(() => void saveCurrentDocument('自动保存'), 900)
    return () => window.clearTimeout(timer)
  }, [document, projectPath, saveState, saveCurrentDocument])

  useEffect(() => {
    if (data) void refreshStats()
  }, [data, refreshStats])

  async function exportProject(format: ExportFormat, options: Omit<ExportInput, 'projectPath' | 'format'> = {}) {
    try {
      const path = await useAppStore.getState().exportProject(format, options)
      window.alert('导出完成：\n' + path + (isDesktop ? '' : '\n\n当前为浏览器开发模式。'))
    } catch (error) {
      useAppStore.getState().setError(error)
    }
  }

  function viewContent() {
    if (!data) return null
    if (activeView === 'dashboard') return <Dashboard />
    if (activeView === 'manuscript') return <EditorPane />
    if (activeView === 'outline') return <PlanningView />
    if (activeView === 'timeline') return <TimelineView />
    if (activeView === 'foreshadowing') return <ForeshadowingView />
    if (activeView === 'relationship') return <RelationshipsView />
    if (activeView === 'consistency') return <ConsistencyView />
    if (activeView === 'statistics') return <StatisticsView />
    if (activeView === 'attachment') return <AttachmentsView />
    if (activeView === 'ai') return <AiAssistantView />
    if (activeView === 'search') return <SearchView />
    if (activeView === 'trash') return <TrashView />
    if (activeView === 'settings') return <SettingsView />
    return <EntityView kind={activeView} />
  }

  if (!data) return <><Welcome onProject={setProjectDialog} /><CommandPalette onNewProject={() => setProjectDialog('new')} onCloseProject={() => void closeProject()} onQuickOpen={() => undefined} /><ProjectDialog mode={projectDialog} onClose={() => setProjectDialog(null)} />{error ? <div className="toast-error"><Undo2 size={15} />{error}<button onClick={clearError}>×</button></div> : null}</>
  const layoutStyle = {
    '--sidebar-width': String(workspacePreferences.sidebarWidth) + 'px',
    '--inspector-width': String(workspacePreferences.inspectorWidth) + 'px',
    '--editor-font-family': workspacePreferences.editorFontFamily === 'sans' ? '"Noto Sans SC", "Microsoft YaHei UI", sans-serif' : '"Noto Serif SC", "Source Han Serif SC", Georgia, serif',
    '--editor-font-size': String(workspacePreferences.editorFontSize) + 'px',
    '--editor-line-height': String(workspacePreferences.editorLineHeight),
    '--content-width': String(workspacePreferences.contentWidth) + 'px',
    '--paragraph-spacing': String(workspacePreferences.paragraphSpacing) + 'px',
  } as CSSProperties
  const transferNode = transferDialog ? data.nodes.find((node) => node.id === transferDialog.nodeId) ?? null : null
  return <div className={'app-shell' + (focusMode ? ' focus-mode' : '')}>{focusMode ? null : <TopBar onProject={setProjectDialog} onExport={() => setExportOpen(true)} onCloseProject={() => void closeProject()} />}<div className={'main-layout' + (focusMode ? ' sidebar-closed inspector-closed' : '') + (sidebarOpen ? '' : ' sidebar-closed') + (inspectorOpen ? '' : ' inspector-closed')} style={layoutStyle}><div className="sidebar-region"><Sidebar onAddNode={(kind, parentId) => setNodeDialog({ kind, parentId })} onMoveNode={(node) => node.kind !== 'volume' && setTransferDialog({ mode: 'move', nodeId: node.id })} onCopyNode={(node) => setTransferDialog({ mode: 'copy', nodeId: node.id })} /><ResizeHandle side="sidebar" width={workspacePreferences.sidebarWidth} onResize={(width) => setWorkspacePreferences({ sidebarWidth: width })} /></div><main className="workspace">{viewContent()}</main><div className="inspector-region"><Inspector /><ResizeHandle side="inspector" width={workspacePreferences.inspectorWidth} onResize={(width) => setWorkspacePreferences({ inspectorWidth: width })} /></div></div>{focusMode ? null : <StatusBar />}<CommandPalette onNewProject={() => setProjectDialog('new')} onCloseProject={() => void closeProject()} onQuickOpen={openQuickOpen} /><QuickOpen /><ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} data={data} currentNodeId={document?.node.id} onExport={exportProject} /><ProjectDialog mode={projectDialog} onClose={() => setProjectDialog(null)} /><NodeDialog kind={nodeDialog?.kind ?? null} parentId={nodeDialog?.parentId ?? null} onClose={() => setNodeDialog(null)} /><NodeTransferDialog mode={transferDialog?.mode ?? null} node={transferNode} data={data} onClose={() => setTransferDialog(null)} onSubmit={async (targetParentId, title) => { if (!transferDialog) return; if (transferDialog.mode === 'move') await useAppStore.getState().moveNode(transferDialog.nodeId, targetParentId); else await useAppStore.getState().copyNode(transferDialog.nodeId, targetParentId, title) }} />{error ? <div className="toast-error"><Undo2 size={15} />{error}<button onClick={clearError}>×</button></div> : null}</div>
}
