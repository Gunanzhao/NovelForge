import { create } from 'zustand'
import { projectApi } from '../lib/api'
import type {
  DocumentData, EntityInput, EntityKind, NodeRecord, ProjectData, ProjectInput,
  SaveState, SearchResult, Stats, ThemeMode, TrashItem, ViewId,
} from '../lib/types'

export interface RecentProject {
  path: string
  title: string
  updatedAt: string
}

const RECENT_KEY = 'novelforge:recent-projects'

function readRecent(): RecentProject[] {
  try {
    const value = localStorage.getItem(RECENT_KEY)
    return value ? JSON.parse(value) as RecentProject[] : []
  } catch {
    return []
  }
}

function writeRecent(projects: RecentProject[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(projects.slice(0, 8)))
  } catch {
    // 最近项目不是核心数据，写入失败不阻断创作。
  }
}

function rememberProject(path: string, data: ProjectData) {
  const projects = [{ path, title: data.project.title, updatedAt: data.project.updatedAt }, ...readRecent().filter((item) => item.path !== path)]
  writeRecent(projects)
  return projects.slice(0, 8)
}

function firstChapter(data: ProjectData) {
  return data.nodes.find((node) => node.kind !== 'volume')
}

const emptyStats: Stats = {
  totalWords: 0, todayWords: 0, yesterdayWords: 0, weekWords: 0, monthWords: 0,
  chapterCount: 0, targetWords: 0, writingStreak: 0,
}

interface AppState {
  projectPath: string | null
  data: ProjectData | null
  document: DocumentData | null
  activeView: ViewId
  selectedEntityId: string | null
  saveState: SaveState
  error: string | null
  stats: Stats
  searchResults: SearchResult[]
  searchQuery: string
  recentProjects: RecentProject[]
  trash: TrashItem[]
  sidebarOpen: boolean
  inspectorOpen: boolean
  focusMode: boolean
  theme: ThemeMode
  editorMode: 'markdown' | 'preview' | 'split'
  setView: (view: ViewId) => void
  setTheme: (theme: ThemeMode) => void
  toggleSidebar: () => void
  toggleInspector: () => void
  toggleFocusMode: () => void
  setEditorMode: (mode: AppState['editorMode']) => void
  clearError: () => void
  setError: (error: unknown) => void
  createProject: (input: ProjectInput) => Promise<void>
  openProject: (path: string) => Promise<void>
  loadRecent: () => void
  selectNode: (nodeId: string) => Promise<void>
  updateContent: (content: string) => void
  saveCurrentDocument: (reason?: string) => Promise<void>
  refreshData: (data: ProjectData, preserveSelection?: boolean) => Promise<void>
  createNode: (kind: NodeRecord['kind'], title: string, parentId: string | null) => Promise<void>
  renameNode: (nodeId: string, title: string) => Promise<void>
  setNodeStatus: (nodeId: string, status: string) => Promise<void>
  reorderNode: (nodeId: string, direction: 'up' | 'down') => Promise<void>
  deleteNode: (nodeId: string) => Promise<void>
  selectEntity: (kind: EntityKind, entityId?: string | null) => void
  saveEntity: (input: EntityInput) => Promise<void>
  deleteEntity: (entityId: string) => Promise<void>
  loadTrash: () => Promise<void>
  restoreTrash: (trashId: string) => Promise<void>
  permanentlyDelete: (trashId: string) => Promise<void>
  runSearch: (query: string, kind?: string) => Promise<void>
  refreshStats: () => Promise<void>
  exportProject: (format: 'markdown' | 'txt') => Promise<string>
  updateProject: (input: { title: string; author: string; description: string; genre: string; targetWords: number }) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  projectPath: null,
  data: null,
  document: null,
  activeView: 'dashboard',
  selectedEntityId: null,
  saveState: 'idle',
  error: null,
  stats: emptyStats,
  searchResults: [],
  searchQuery: '',
  recentProjects: [],
  trash: [],
  sidebarOpen: true,
  inspectorOpen: true,
  focusMode: false,
  theme: 'system',
  editorMode: 'split',

  setView: (view) => set({ activeView: view }),
  setTheme: (theme) => {
    set({ theme })
    try { localStorage.setItem('novelforge:theme', theme) } catch { /* optional preference */ }
  },
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  setEditorMode: (editorMode) => set({ editorMode }),
  clearError: () => set({ error: null }),
  setError: (error) => set({ error: error instanceof Error ? error.message : String(error) }),

  loadRecent: () => {
    let theme: ThemeMode = 'system'
    try {
      const storedTheme = localStorage.getItem('novelforge:theme') as ThemeMode | null
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') theme = storedTheme
    } catch { /* use default */ }
    set({ recentProjects: readRecent(), theme })
  },

  createProject: async (input) => {
    try {
      const data = await projectApi.create(input)
      set({ projectPath: input.path, data, document: null, activeView: 'manuscript', error: null, selectedEntityId: null })
      const chapter = firstChapter(data)
      if (chapter) await get().selectNode(chapter.id)
      set({ recentProjects: rememberProject(input.path, data) })
      await get().refreshStats()
    } catch (error) {
      get().setError(error)
      throw error
    }
  },

  openProject: async (path) => {
    try {
      const data = await projectApi.open(path)
      set({ projectPath: path, data, document: null, activeView: 'dashboard', error: null, selectedEntityId: null })
      const chapter = firstChapter(data)
      if (chapter) await get().selectNode(chapter.id)
      set({ recentProjects: rememberProject(path, data) })
      await get().refreshStats()
    } catch (error) {
      get().setError(error)
      throw error
    }
  },

  selectNode: async (nodeId) => {
    const path = get().projectPath
    if (!path) return
    const selected = get().data?.nodes.find((node) => node.id === nodeId)
    if (!selected || selected.kind === 'volume') {
      set({ document: null })
      return
    }
    try {
      const document = await projectApi.getDocument({ projectPath: path, nodeId })
      set({ document, activeView: 'manuscript', selectedEntityId: null, error: null, saveState: 'saved' })
    } catch (error) {
      get().setError(error)
    }
  },

  updateContent: (content) => set((state) => state.document ? ({ document: { ...state.document, content }, saveState: 'idle' }) : state),

  saveCurrentDocument: async (reason = '自动保存') => {
    const { projectPath, document } = get()
    if (!projectPath || !document) return
    set({ saveState: 'saving', error: null })
    try {
      const saved = await projectApi.saveDocument({
        projectPath, nodeId: document.node.id, content: document.content, reason,
      })
      set((state) => ({
        document: saved,
        saveState: 'saved',
        data: state.data ? { ...state.data, nodes: state.data.nodes.map((node) => node.id === saved.node.id ? saved.node : node) } : state.data,
      }))
      await get().refreshStats()
    } catch (error) {
      set({ saveState: 'error' })
      get().setError(error)
    }
  },

  refreshData: async (data, preserveSelection = true) => {
    const currentNodeId = preserveSelection ? get().document?.node.id : undefined
    set({ data, error: null })
    if (currentNodeId && data.nodes.some((node) => node.id === currentNodeId)) await get().selectNode(currentNodeId)
  },

  createNode: async (kind, title, parentId) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      const data = await projectApi.createNode({ projectPath, kind, title, parentId })
      await get().refreshData(data, true)
    } catch (error) { get().setError(error); throw error }
  },

  renameNode: async (nodeId, title) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      const data = await projectApi.renameNode({ projectPath, nodeId, title })
      await get().refreshData(data, true)
    } catch (error) { get().setError(error); throw error }
  },

  setNodeStatus: async (nodeId, status) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try { await get().refreshData(await projectApi.setNodeStatus({ projectPath, nodeId, status }), true) }
    catch (error) { get().setError(error) }
  },

  reorderNode: async (nodeId, direction) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try { await get().refreshData(await projectApi.reorderNode({ projectPath, nodeId, direction }), true) }
    catch (error) { get().setError(error) }
  },

  deleteNode: async (nodeId) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      const data = await projectApi.deleteNode({ projectPath, nodeId })
      const next = firstChapter(data)
      set({ document: null })
      await get().refreshData(data, false)
      if (next) await get().selectNode(next.id)
    } catch (error) { get().setError(error); throw error }
  },

  selectEntity: (kind, entityId = null) => set({ activeView: kind, selectedEntityId: entityId }),

  saveEntity: async (input) => {
    try {
      const data = await projectApi.upsertEntity(input)
      await get().refreshData(data, true)
    } catch (error) { get().setError(error); throw error }
  },

  deleteEntity: async (entityId) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      const data = await projectApi.deleteEntity({ projectPath, nodeId: entityId })
      await get().refreshData(data, false)
      set({ selectedEntityId: null })
    } catch (error) { get().setError(error); throw error }
  },

  loadTrash: async () => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try { set({ trash: await projectApi.listTrash(projectPath) }) }
    catch (error) { get().setError(error) }
  },

  restoreTrash: async (trashId) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      await get().refreshData(await projectApi.restoreTrash({ projectPath, nodeId: trashId }), false)
      await get().loadTrash()
    } catch (error) { get().setError(error) }
  },

  permanentlyDelete: async (trashId) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      await get().refreshData(await projectApi.permanentDelete({ projectPath, nodeId: trashId }), false)
      await get().loadTrash()
    } catch (error) { get().setError(error) }
  },

  runSearch: async (query, kind) => {
    const projectPath = get().projectPath
    set({ searchQuery: query })
    if (!projectPath || !query.trim()) {
      set({ searchResults: [] })
      return
    }
    try { set({ searchResults: await projectApi.search({ projectPath, query, kind }) }) }
    catch (error) { get().setError(error) }
  },

  refreshStats: async () => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try { set({ stats: await projectApi.stats(projectPath) }) }
    catch (error) { get().setError(error) }
  },

  exportProject: async (format) => {
    const projectPath = get().projectPath
    if (!projectPath) throw new Error('请先打开一个项目')
    return projectApi.exportProject({ projectPath, format })
  },

  updateProject: async (input) => {
    const projectPath = get().projectPath
    if (!projectPath) return
    try { await get().refreshData(await projectApi.updateProject({ projectPath, ...input }), true) }
    catch (error) { get().setError(error); throw error }
  },
}))
