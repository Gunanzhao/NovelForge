import { useEffect, useState } from 'react'
import {
  BookOpen, Check, FileDown, FolderOpen, Menu, Moon, PanelRight, Plus, Search,
  Settings, Sun, Undo2,
} from 'lucide-react'
import { isDesktop } from './lib/api'
import type { NodeKind } from './lib/types'
import { useAppStore } from './stores/app-store'
import { Dashboard } from './components/Dashboard'
import { EditorPane } from './components/EditorPane'
import { EntityView } from './components/EntityView'
import { Inspector } from './components/Inspector'
import { ProjectDialog, NodeDialog } from './components/ProjectDialogs'
import { SearchView } from './components/SearchView'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { TrashView } from './components/TrashView'
import { Button, IconButton } from './components/ui'
import { formatNumber } from './lib/utils'

function Welcome({ onProject }: { onProject: (mode: 'new' | 'open') => void }) {
  const recentProjects = useAppStore((state) => state.recentProjects)
  const openProject = useAppStore((state) => state.openProject)
  const setError = useAppStore((state) => state.setError)
  return <div className="welcome"><div className="welcome-card"><div className="welcome-title"><span className="brand-mark">N</span><div><h1>NovelForge</h1><p>本地优先的中文长篇小说创作工作台</p></div></div><p className="welcome-copy">把正文、人物、地点和世界观放在一个安静的工作台里。正文始终是普通 Markdown 文件，SQLite 只负责资料与搜索索引；没有账号、没有 API Key，也可以完整写作。</p><div className="welcome-actions"><Button onClick={() => onProject('new')}><Plus size={15} />新建小说</Button><Button variant="outline" onClick={() => onProject('open')}><FolderOpen size={15} />打开项目</Button></div>{recentProjects.length ? <><p className="eyebrow">RECENT PROJECTS</p><div className="recent-projects">{recentProjects.map((project) => <button className="recent-project" key={project.path} onClick={() => void openProject(project.path).catch(setError)}><BookOpen size={16} /><span><strong>{project.title}</strong><small>{project.path}</small></span></button>)}</div></> : <div className="panel empty-state"><BookOpen size={25} /><div><strong>从一部小说开始</strong><span>选择一个空文件夹，NovelForge 会创建 project.json、Markdown 正文和 .novelforge 数据目录。</span></div></div>}</div></div>
}

function TopBar({ onProject, onExport }: { onProject: (mode: 'new' | 'open') => void; onExport: (format: 'markdown' | 'txt') => void }) {
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

  return <header className="topbar"><IconButton icon={Menu} label={sidebarOpen ? '收起左栏' : '展开左栏'} onClick={toggleSidebar} /><div className="brand"><span className="brand-mark">N</span><span className="brand-name">NovelForge</span><span className="brand-subtitle">写作工作台</span></div><div className="topbar-title"><strong>{data?.project.title ?? '未打开项目'}</strong><span>{projectPath ?? '本地优先 · Markdown first'}</span></div><div className="topbar-actions"><Button variant="ghost" onClick={() => onProject('new')}><Plus size={14} />新建</Button><Button variant="ghost" onClick={() => onProject('open')}><FolderOpen size={14} />打开</Button>{data ? <><span className="topbar-divider" /><Button variant="ghost" onClick={() => void saveCurrentDocument('手动保存')}><Check size={14} color={saveState === 'saved' ? 'var(--green)' : undefined} />保存</Button><Button variant="ghost" onClick={() => setView('search')}><Search size={14} />搜索</Button><Button variant="ghost" onClick={() => onExport('markdown')}><FileDown size={14} />导出</Button><span className="topbar-divider" /><IconButton icon={sidebarOpen ? Menu : PanelRight} label="切换左栏" onClick={toggleSidebar} className={sidebarOpen ? 'active' : ''} /><IconButton icon={PanelRight} label={inspectorOpen ? '收起辅助栏' : '展开辅助栏'} onClick={toggleInspector} className={inspectorOpen ? 'active' : ''} /><IconButton icon={theme === 'dark' ? Sun : Moon} label="切换主题" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} /><IconButton icon={Settings} label="项目设置" onClick={() => setView('settings')} /></> : null}</div></header>
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
  const error = useAppStore((state) => state.error)
  const loadRecent = useAppStore((state) => state.loadRecent)
  const saveCurrentDocument = useAppStore((state) => state.saveCurrentDocument)
  const clearError = useAppStore((state) => state.clearError)
  const setView = useAppStore((state) => state.setView)
  const refreshStats = useAppStore((state) => state.refreshStats)
  const [projectDialog, setProjectDialog] = useState<'new' | 'open' | null>(null)
  const [nodeDialog, setNodeDialog] = useState<{ kind: NodeKind; parentId: string | null } | null>(null)

  useEffect(() => { loadRecent() }, [loadRecent])

  useEffect(() => {
    const applyTheme = () => {
      const resolved = theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : theme === 'system' ? 'light' : theme
      globalThis.document.documentElement.dataset.theme = resolved
    }
    applyTheme()
  }, [theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void saveCurrentDocument('快捷键保存') }
      else if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); setView('search') }
      else if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); setProjectDialog('new') }
      else if (event.key === 'F11') { event.preventDefault(); useAppStore.getState().toggleFocusMode() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveCurrentDocument, setView])

  useEffect(() => {
    if (saveState !== 'idle' || !document || !projectPath) return
    const timer = window.setTimeout(() => void saveCurrentDocument('自动保存'), 900)
    return () => window.clearTimeout(timer)
  }, [document, projectPath, saveState, saveCurrentDocument])

  useEffect(() => {
    if (data) void refreshStats()
  }, [data, refreshStats])

  function exportProject(format: 'markdown' | 'txt') {
    void useAppStore.getState().exportProject(format).then((path) => window.alert('导出完成：\n' + path + (isDesktop ? '' : '\n\n当前为浏览器开发模式。'))).catch(useAppStore.getState().setError)
  }

  function viewContent() {
    if (!data) return null
    if (activeView === 'dashboard') return <Dashboard />
    if (activeView === 'manuscript') return <EditorPane />
    if (activeView === 'search') return <SearchView />
    if (activeView === 'trash') return <TrashView />
    if (activeView === 'settings') return <SettingsView />
    return <EntityView kind={activeView} />
  }

  if (!data) return <><Welcome onProject={setProjectDialog} /><ProjectDialog mode={projectDialog} onClose={() => setProjectDialog(null)} />{error ? <div className="toast-error"><Undo2 size={15} />{error}<button onClick={clearError}>×</button></div> : null}</>
  return <div className={'app-shell' + (focusMode ? ' focus-mode' : '')}>{focusMode ? null : <TopBar onProject={setProjectDialog} onExport={exportProject} />}<div className={'main-layout' + (focusMode ? ' sidebar-closed inspector-closed' : '') + (sidebarOpen ? '' : ' sidebar-closed') + (inspectorOpen ? '' : ' inspector-closed')}><Sidebar onAddNode={(kind, parentId) => setNodeDialog({ kind, parentId })} /><main className="workspace">{viewContent()}</main><Inspector /></div>{focusMode ? null : <StatusBar />}<ProjectDialog mode={projectDialog} onClose={() => setProjectDialog(null)} /><NodeDialog kind={nodeDialog?.kind ?? null} parentId={nodeDialog?.parentId ?? null} onClose={() => setNodeDialog(null)} />{error ? <div className="toast-error"><Undo2 size={15} />{error}<button onClick={clearError}>×</button></div> : null}</div>
}
