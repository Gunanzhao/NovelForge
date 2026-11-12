import {
  Check,
  ChevronRight,
  Feather,
  FileDown,
  FolderOpen,
  Maximize2,
  Menu,
  Moon,
  PanelRight,
  Plus,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { viewLabel } from '../../app/navigation'
import { saveWorkspace } from '../../lib/draft-guard'
import { useAppStore } from '../../stores/app-store'
import { ActionMenu, Button, IconButton } from '../ui'
import type { ProjectDialogMode } from './Welcome'

interface TopBarProps {
  onProject: (mode: ProjectDialogMode) => void
  onExport: () => void
  onCloseProject: () => void
  inspectorVisible: boolean
  onInspectorToggle: () => void
}

export function TopBar({
  onProject,
  onExport,
  onCloseProject,
  inspectorVisible,
  onInspectorToggle,
}: TopBarProps) {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveState = useAppStore((state) => state.saveState)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const activeView = useAppStore((state) => state.activeView)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const setView = useAppStore((state) => state.setView)
  const setTheme = useAppStore((state) => state.setTheme)
  const theme = useAppStore((state) => state.theme)
  const toggleFocusMode = useAppStore((state) => state.toggleFocusMode)
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <header className="topbar studio-topbar">
      <div className="topbar-start">
        <IconButton
          icon={Menu}
          label={sidebarOpen ? '收起左栏' : '展开左栏'}
          onClick={toggleSidebar}
        />
        <button
          className="studio-home"
          onClick={() => setView('dashboard')}
          aria-label="返回项目总览"
        >
          <span className="brand-mark">
            <Feather size={18} />
          </span>
          <span className="brand-name">NovelForge</span>
        </button>
      </div>
      <div className="topbar-title">
        <strong title={projectPath ?? undefined}>
          {data?.project.title ?? '未打开项目'}
        </strong>
        <ChevronRight size={13} />
        <span>{viewLabel(activeView)}</span>
      </div>
      <button
        className="workspace-search"
        onClick={() => window.dispatchEvent(new Event('novelforge:quick-open'))}
        aria-label="快速打开章节或资料"
      >
        <Search size={15} />
        <span>查找章节、资料…</span>
        <kbd>Ctrl P</kbd>
      </button>
      <div className="topbar-actions">
        <ActionMenu label="项目">
          <Button variant="ghost" onClick={() => onProject('new')}>
            <Plus size={14} />
            新建小说
          </Button>
          <Button variant="ghost" onClick={() => onProject('open')}>
            <FolderOpen size={14} />
            打开项目
          </Button>
          <Button variant="ghost" onClick={() => onProject('import')}>
            <FileDown size={14} />
            从已有稿件开始
          </Button>
          <Button variant="ghost" onClick={onCloseProject}>
            <X size={14} />
            关闭项目
          </Button>
        </ActionMenu>
        <Button
          variant="ghost"
          className="topbar-save"
          onClick={() => void saveWorkspace('手动保存')}
          title="保存所有修改 · Ctrl+S"
        >
          <Check
            size={15}
            color={saveState === 'saved' ? 'var(--green)' : undefined}
          />
          保存
        </Button>
        <IconButton
          icon={Maximize2}
          label="进入专注模式"
          onClick={toggleFocusMode}
          title="专注模式 · F11"
        />
        <IconButton
          icon={dark ? Sun : Moon}
          label="切换主题"
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        />
        <IconButton
          icon={Settings}
          label="项目设置"
          onClick={() => setView('settings')}
        />
        <IconButton
          icon={PanelRight}
          disabled={activeView !== 'manuscript'}
          label={
            activeView !== 'manuscript'
              ? '章节辅助栏在正文页可用'
              : inspectorVisible
                ? '收起辅助栏'
                : '展开辅助栏'
          }
          onClick={onInspectorToggle}
          className={inspectorVisible ? 'active' : ''}
        />
        <Button className="topbar-export" onClick={onExport}>
          <FileDown size={14} />
          导出
        </Button>
      </div>
    </header>
  )
}
