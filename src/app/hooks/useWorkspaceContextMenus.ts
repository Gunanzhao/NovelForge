import { Check, FolderOpen, Plus, Search, Settings } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { dispatchCommand } from '../../lib/command-registry'
import type {
  ContextMenuItem,
  ContextMenuLocation,
  ContextMenuPayload,
} from '../../lib/context-menu'
import { saveWorkspace } from '../../lib/draft-guard'
import { runtimePluginRegistry } from '../../lib/plugin-registry'
import { useAppStore } from '../../stores/app-store'

import type { ProjectDialogMode } from '../../components/shell/Welcome'

export function useWorkspaceContextMenus(
  onProject: (mode: ProjectDialogMode) => void,
  onQuickOpen: () => void,
) {
  const data = useAppStore((state) => state.data)
  const document = useAppStore((state) => state.document)
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const toggleFocusMode = useAppStore((state) => state.toggleFocusMode)
  const pluginItems = useCallback(
    (
      location: ContextMenuLocation,
      payload: ContextMenuPayload,
    ): ContextMenuItem[] =>
      runtimePluginRegistry.contextMenus(location, payload).map((item) => ({
        type: 'item' as const,
        id: 'plugin-' + item.id,
        label: item.label,
        disabled: item.contextEnabled === false,
        onSelect: async () => {
          await item.execute(payload)
        },
      })),
    [],
  )
  const fallbackItems = useMemo<ContextMenuItem[]>(() => {
    if (!data) {
      return [
        {
          type: 'item',
          id: 'workspace-new-project',
          label: '新建小说',
          icon: Plus,
          shortcut: 'Ctrl+N',
          onSelect: () => onProject('new'),
        },
        {
          type: 'item',
          id: 'workspace-open-project',
          label: '打开项目',
          icon: FolderOpen,
          onSelect: () => onProject('open'),
        },
        { type: 'separator' },
        {
          type: 'item',
          id: 'workspace-command-palette',
          label: '打开命令面板',
          icon: Search,
          shortcut: 'Ctrl+Shift+P',
          onSelect: () => dispatchCommand('open-palette'),
        },
      ]
    }
    return [
      {
        type: 'item',
        id: 'workspace-save',
        label: '保存当前修改',
        icon: Check,
        shortcut: 'Ctrl+S',
        disabled: !document,
        onSelect: () => {
          void saveWorkspace('右键菜单保存')
        },
      },
      {
        type: 'item',
        id: 'workspace-quick-open',
        label: '快速打开',
        shortcut: 'Ctrl+P',
        onSelect: onQuickOpen,
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'workspace-search',
        label: '当前章节搜索',
        icon: Search,
        shortcut: 'Ctrl+F',
        onSelect: () => dispatchCommand('open-search'),
      },
      {
        type: 'item',
        id: 'workspace-full-search',
        label: '全项目搜索',
        icon: Search,
        shortcut: 'Ctrl+Shift+F',
        onSelect: () => dispatchCommand('open-full-search'),
      },
      {
        type: 'item',
        id: 'workspace-command-palette',
        label: '打开命令面板',
        shortcut: 'Ctrl+Shift+P',
        onSelect: () => dispatchCommand('open-palette'),
      },
      {
        type: 'item',
        id: 'workspace-focus',
        label: '专注模式',
        shortcut: 'F11',
        onSelect: toggleFocusMode,
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'workspace-theme',
        label: '主题',
        children: [
          {
            type: 'item',
            id: 'theme-light',
            label: '浅色',
            checked: theme === 'light',
            onSelect: () => setTheme('light'),
          },
          {
            type: 'item',
            id: 'theme-dark',
            label: '深色',
            checked: theme === 'dark',
            onSelect: () => setTheme('dark'),
          },
          {
            type: 'item',
            id: 'theme-system',
            label: '跟随系统',
            checked: theme === 'system',
            onSelect: () => setTheme('system'),
          },
        ],
        onSelect: () => undefined,
      },
      {
        type: 'item',
        id: 'workspace-settings',
        label: '项目设置',
        icon: Settings,
        onSelect: () => useAppStore.getState().setView('settings'),
      },
    ]
  }, [data, document, onProject, onQuickOpen, setTheme, theme, toggleFocusMode])

  return { pluginItems, fallbackItems }
}
