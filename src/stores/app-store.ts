import { notify } from '../lib/notifications'
import { readEditorSession, rememberEditor } from '../lib/editor-session'
import { confirmDraftNavigation, dirtyDrafts, runGuarded } from '../lib/draft-guard'
import { create } from 'zustand'
import { isNodeLocked } from '../lib/node-lock'
import { projectApi } from '../lib/api'
import type {
  DocumentData, EditorSelection, EntityInput, EntityKind, NodeRecord, ProjectData, ProjectInput,
  ExportFormat, ExportInput, SaveState, SearchResult, Stats, ThemeMode, TrashItem, ViewId,
} from '../lib/types'
import {
  DEFAULT_WORKSPACE_PREFERENCES, normalizeWorkspacePreferences, readWorkspacePreferences, writeWorkspacePreferences,
} from '../lib/workspace-preferences'
import type { WorkspacePreferences } from '../lib/workspace-preferences'
import { sortChapterNodes } from '../lib/planning-data'
import type { AiAction } from '../lib/ai-data'
import { chapterChecklistInput, checklistForChapter } from '../lib/chapter-workflow'

export interface RecentProject {
  path: string
  title: string
  updatedAt: string
}

function persistPreferences(preferences: WorkspacePreferences, theme: ThemeMode) {
  const saved = writeWorkspacePreferences(preferences)
  try {
    localStorage.setItem('novelforge:theme', theme)
    return saved ? null : '偏好未保存到本机；本次窗口内仍生效。'
  } catch { return '偏好未保存到本机；本次窗口内仍生效。' }
}
const RECENT_KEY = 'novelforge:recent-projects'
let statsGeneration = 0
let searchGeneration = 0
let selectionGeneration = 0
let transitionGeneration = 0
let conflictGeneration = 0

export interface ProjectSession {
  path: string | null
  id: string | undefined
  generation: number
}

export function captureProjectSession(): ProjectSession {
  const state = useAppStore.getState()
  return { path: state.projectPath, id: state.data?.project.id, generation: state.projectSession }
}

export function isCurrentProjectSession(session: ProjectSession) {
  const state = useAppStore.getState()
  return state.projectPath === session.path && state.data?.project.id === session.id && state.projectSession === session.generation
}

export function isCurrentDocumentSaved() {
  const state = useAppStore.getState()
  return !state.document || state.saveState === 'saved'
}

async function releaseForTransition(path: string | null, isCurrent: () => boolean) {
  const before = useAppStore.getState()
  if (!isCurrentDocumentSaved()) throw new Error('正文仍有新修改，已取消离开，请重试。')
  if (path) await (before.projectLease ? projectApi.release(path, before.projectLease) : projectApi.release?.(path))
  const after = useAppStore.getState()
  if (!isCurrent() || after.projectSession !== before.projectSession || after.documentVersion !== before.documentVersion || !isCurrentDocumentSaved()) {
    // Reacquire the current project's lease without replacing any editor content.
    if (path && after.projectPath === path && after.projectSession === before.projectSession) {
      if (before.projectLease) await projectApi.retain(path, before.projectLease)
      else if (after.document) await projectApi.getDocument({ projectPath: path, nodeId: after.document.node.id })
    }
    throw new Error('关闭项目期间正文或项目已变化，已保留当前内容，请重试。')
  }
}

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
  return sortChapterNodes(data.nodes)[0]
}

async function addInitialChecklist(projectPath: string, data: ProjectData, chapter: NodeRecord) {
  if (checklistForChapter(data.entities, chapter.id)) return data
  return projectApi.upsertEntity(chapterChecklistInput(projectPath, chapter, data.entities))
}

const emptyStats: Stats = {
  totalWords: 0, currentVolumeWords: 0, currentChapterWords: 0, todayWords: 0, yesterdayWords: 0, weekWords: 0, monthWords: 0,
  chapterCount: 0, targetWords: 0, writingStreak: 0, averageDailyWords: 0, longestWritingStreak: 0, daily: [], chapterStats: [],
}

interface AppState {
  projectLease: string | null
  projectPath: string | null
  projectSession: number
  data: ProjectData | null
  document: DocumentData | null
  editorSelection: EditorSelection | null
  requestedAiAction: AiAction | null
  activeView: ViewId
  selectedEntityId: string | null
  saveState: SaveState
  deletingNodes: string[]
  documentVersion: number
  error: string | null
  stats: Stats
  searchResults: SearchResult[]
  searchQuery: string
  recentProjects: RecentProject[]
  trash: TrashItem[]
  sidebarOpen: boolean
  inspectorOpen: boolean
  inspectorTab: 'chapter' | 'ai'
  setInspectorTab: (tab: 'chapter' | 'ai') => void
  openEditorAi: (action?: AiAction) => void
  focusMode: boolean
  theme: ThemeMode
  preferenceError: string | null
  workspacePreferences: WorkspacePreferences
  editorMode: 'markdown' | 'preview' | 'split'
  setView: (view: ViewId) => void
  setTheme: (theme: ThemeMode) => void
  setWorkspacePreferences: (patch: Partial<WorkspacePreferences>) => void
  toggleSidebar: () => void
  toggleInspector: () => void
  toggleFocusMode: () => void
  setEditorMode: (mode: AppState['editorMode']) => void
  openAiAssistant: (action?: AiAction) => void
  consumeAiAction: () => void
  reloadConflictedDocument: () => Promise<boolean>
  clearError: () => void
  setError: (error: unknown) => void
  createProject: (input: ProjectInput) => Promise<void>
  openProject: (path: string) => Promise<void>
  closeProject: () => Promise<boolean>
  loadRecent: () => void
  selectNode: (nodeId: string, reload?: boolean) => Promise<void>
  setEditorSelection: (selection: EditorSelection | null) => void
  updateContent: (content: string) => void
  saveCurrentDocument: (reason?: string) => Promise<boolean>
  refreshData: (data: ProjectData, preserveSelection?: boolean, session?: ProjectSession) => Promise<void>
  createNode: (kind: NodeRecord['kind'], title: string, parentId: string | null) => Promise<void>
  renameNode: (nodeId: string, title: string) => Promise<void>
  setNodeStatus: (nodeId: string, status: string) => Promise<void>
  reorderNode: (nodeId: string, direction: 'up' | 'down') => Promise<void>
  moveNode: (nodeId: string, targetParentId: string | null, targetOrderIndex?: number) => Promise<void>
  copyNode: (nodeId: string, targetParentId: string | null, title?: string) => Promise<void>
  deleteNode: (nodeId: string) => Promise<void>
  selectEntity: (kind: EntityKind, entityId?: string | null) => void
  saveEntity: (input: EntityInput) => Promise<void>
  deleteEntity: (entityId: string) => Promise<void>
  trashLoading: boolean
  trashError: string | null
  loadTrash: () => Promise<void>
  restoreTrash: (trashId: string) => Promise<void>
  permanentlyDelete: (trashId: string) => Promise<void>
  emptyTrash: () => Promise<void>
  runSearch: (query: string, options?: Omit<import('../lib/types').SearchInput, 'projectPath' | 'query'>) => Promise<void>
  refreshStats: () => Promise<void>
  exportProject: (format: ExportFormat, options?: Omit<ExportInput, 'projectPath' | 'format'>) => Promise<string>
  updateProject: (input: { title: string; author: string; description: string; genre: string; targetWords: number }) => Promise<void>
}

let activeSave: Promise<boolean> | null = null

export const useAppStore = create<AppState>((set, get) => ({
  projectLease: null,
  projectPath: null,
  projectSession: 0,
  data: null,
  document: null,
  editorSelection: null,
  requestedAiAction: null,
  activeView: 'dashboard',
  selectedEntityId: null,
  saveState: 'idle',
  deletingNodes: [],
  documentVersion: 0,
  error: null,
  stats: emptyStats,
  searchResults: [],
  searchQuery: '',
  recentProjects: [],
  trashLoading: false, trashError: null,
  trash: [],
  sidebarOpen: DEFAULT_WORKSPACE_PREFERENCES.sidebarOpen,
  inspectorOpen: DEFAULT_WORKSPACE_PREFERENCES.inspectorOpen,
  inspectorTab: 'chapter',
  setInspectorTab: (inspectorTab) => set({ inspectorTab, inspectorOpen: true }),
  openEditorAi: (action) => {
    const selection = get().editorSelection
    set({ activeView: 'manuscript', inspectorOpen: true, inspectorTab: 'ai', requestedAiAction: action ?? (selection?.text.trim() ? 'polish' : 'continue') })
  },
  focusMode: false,
  theme: 'system',
  workspacePreferences: { ...DEFAULT_WORKSPACE_PREFERENCES },
  preferenceError: null,
  editorMode: 'markdown',

  setView: (view) => { if (view === get().activeView) return; runGuarded(() => set({ activeView: view })) },
  setTheme: (theme) => {
    set({ theme, preferenceError: persistPreferences(get().workspacePreferences, theme) })
  },
  setWorkspacePreferences: (patch) => set((state) => {
    const next = normalizeWorkspacePreferences({ ...state.workspacePreferences, ...patch })
    return { workspacePreferences: next, preferenceError: persistPreferences(next, state.theme) }
  }),
  toggleSidebar: () => set((state) => {
    const sidebarOpen = !state.sidebarOpen
    const workspacePreferences = { ...state.workspacePreferences, sidebarOpen }
    return { sidebarOpen, workspacePreferences, preferenceError: persistPreferences(workspacePreferences, state.theme) }
  }),
  toggleInspector: () => set((state) => {
    const inspectorOpen = !state.inspectorOpen
    const workspacePreferences = { ...state.workspacePreferences, inspectorOpen }
    return { inspectorOpen, workspacePreferences, preferenceError: persistPreferences(workspacePreferences, state.theme) }
  }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  setEditorMode: (editorMode) => set({ editorMode }),
  openAiAssistant: (action) => runGuarded(() => set({ activeView: 'ai', requestedAiAction: action ?? null })),
  consumeAiAction: () => set({ requestedAiAction: null }),
  clearError: () => { ++conflictGeneration; set({ error: null }) },
  setError: (error) => set({ error: error instanceof Error ? error.message : String(error) }),

  loadRecent: () => {
    let theme: ThemeMode = 'system'
    try {
      const storedTheme = localStorage.getItem('novelforge:theme') as ThemeMode | null
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') theme = storedTheme
    } catch { /* use default */ }
    const workspacePreferences = readWorkspacePreferences()
    set({ recentProjects: readRecent(), theme, workspacePreferences, sidebarOpen: workspacePreferences.sidebarOpen, inspectorOpen: workspacePreferences.inspectorOpen })
  },

  createProject: async (input) => {
    if (dirtyDrafts().length && !await confirmDraftNavigation()) return
    const request = ++transitionGeneration
    let targetLease: string | undefined
    let adopted = false
    try {
      if (get().document) {
        const saved = await get().saveCurrentDocument('切换项目前保存')
        if (!saved) throw new Error('当前正文保存失败，已取消创建新项目')
      }
      if (request !== transitionGeneration) return
      let data = await projectApi.create(input)
      targetLease = data.leaseToken
      let checklistError: unknown = null
      const initialChapter = firstChapter(data)
      if (initialChapter) {
        try { data = await addInitialChecklist(input.path, data, initialChapter) }
        catch (error) { checklistError = error }
      }
      if (request !== transitionGeneration) return
      if (get().document && !await get().saveCurrentDocument('切换项目前保存')) throw new Error('当前正文保存失败，已保留当前项目')
      if (request !== transitionGeneration) return
      const previousPath = get().projectPath
      await releaseForTransition(previousPath, () => request === transitionGeneration)
      if (request !== transitionGeneration) return
      ++selectionGeneration
      set((state) => ({ projectPath: input.path, projectLease: targetLease ?? null, projectSession: state.projectSession + 1, deletingNodes: [], data, document: null, editorMode: 'markdown', editorSelection: null, documentVersion: state.documentVersion + 1, activeView: 'manuscript', error: null, selectedEntityId: null, searchResults: [], searchQuery: '', trash: [], trashLoading: false, trashError: null, stats: emptyStats, saveState: 'saved' }))
      adopted = true
      if (checklistError) get().setError(checklistError)
      const chapter = firstChapter(data)
      if (chapter) await get().selectNode(chapter.id)
      if (request !== transitionGeneration) return
      set({ recentProjects: rememberProject(input.path, data) })
      await get().refreshStats()
    } catch (error) {
      if (request === transitionGeneration) get().setError(error)
      throw error
    } finally { if (targetLease && !adopted) await projectApi.release(input.path, targetLease) }
  },

  openProject: async (path) => {
    if (dirtyDrafts().length && !await confirmDraftNavigation()) return
    const request = ++transitionGeneration
    let targetLease: string | undefined
    let adopted = false
    try {
      if (get().document) {
        const saved = await get().saveCurrentDocument('切换项目前保存')
        if (!saved) throw new Error('当前正文保存失败，已取消打开其他项目')
      }
      if (request !== transitionGeneration) return
      const data = await projectApi.open(path)
      targetLease = data.leaseToken
      if (request !== transitionGeneration) return
      if (get().document && !await get().saveCurrentDocument('切换项目前保存')) throw new Error('当前正文保存失败，已保留当前项目')
      if (request !== transitionGeneration) return
      const previousPath = get().projectPath
      await releaseForTransition(previousPath, () => request === transitionGeneration)
      if (request !== transitionGeneration) return
      ++selectionGeneration
      set((state) => ({ projectPath: path, projectLease: targetLease ?? null, projectSession: state.projectSession + 1, deletingNodes: [], data, document: null, editorMode: 'markdown', editorSelection: null, documentVersion: state.documentVersion + 1, activeView: 'dashboard', error: null, selectedEntityId: null, searchResults: [], searchQuery: '', trash: [], trashLoading: false, trashError: null, stats: emptyStats, saveState: 'saved' }))
      adopted = true
      const remembered = readEditorSession(path).nodeId
      const chapter = data.nodes.find(node => node.id === remembered && node.kind !== 'volume') ?? firstChapter(data)
      if (chapter) await get().selectNode(chapter.id)
      if (request !== transitionGeneration) return
      set({ recentProjects: rememberProject(path, data) })
      await get().refreshStats()
    } catch (error) {
      if (request === transitionGeneration) get().setError(error)
      throw error
    } finally { if (targetLease && !adopted) await projectApi.release(path, targetLease) }
  },

  closeProject: async () => {
    if (dirtyDrafts().length && !await confirmDraftNavigation()) return false
    const request = ++transitionGeneration
    if (get().document) {
      const saved = await get().saveCurrentDocument('关闭项目前保存')
      if (!saved) return false
    }
    if (request !== transitionGeneration) return false
    try { await releaseForTransition(get().projectPath, () => request === transitionGeneration) }
    catch (error) { if (request === transitionGeneration) get().setError(error); return false }
    ++selectionGeneration
    set((state) => ({
      projectLease: null,
  projectPath: null,
      projectSession: state.projectSession + 1,
      data: null,
      document: null,
      editorSelection: null,
      documentVersion: state.documentVersion + 1,
      activeView: 'dashboard',
      selectedEntityId: null,
      searchResults: [],
      searchQuery: '',
      trashLoading: false, trashError: null,
  trash: [],
      stats: emptyStats,
      error: null,
      saveState: 'idle',
    }))
    return true
  },

  selectNode: async (nodeId, reload = false) => {
    if (get().deletingNodes.includes(nodeId)) return
    if (dirtyDrafts().length && !await confirmDraftNavigation()) return
    const request = ++selectionGeneration
    const session = captureProjectSession()
    const path = get().projectPath
    if (!path) return
    const current = get().document
    if (current && current.node.id !== nodeId) {
      const saved = await get().saveCurrentDocument('切换章节前保存')
      if (!saved) return
      if (!isCurrentDocumentSaved()) { get().setError('正文仍有新修改，已取消切换。'); return }
    }
    if (request !== selectionGeneration || !isCurrentProjectSession(session)) return
    const selected = get().data?.nodes.find((node) => node.id === nodeId)
    if (!selected || selected.kind === 'volume') {
      set((state) => ({ document: null, editorSelection: null, documentVersion: state.documentVersion + 1 }))
      return
    }
    if (!reload && get().document?.node.id === nodeId) { set({ activeView: 'manuscript', selectedEntityId: null }); return }
    const version = get().documentVersion
    try {
      const document = await projectApi.getDocument({ projectPath: path, nodeId })
      if (request !== selectionGeneration || !isCurrentProjectSession(session) || get().documentVersion !== version || get().deletingNodes.includes(nodeId)) return
      rememberEditor(path, nodeId)
      set((state) => ({ document: { ...document, persistedContent: document.content }, editorSelection: null, documentVersion: state.documentVersion + 1, activeView: 'manuscript', selectedEntityId: null, error: null, saveState: 'saved' }))
    } catch (error) {
      if (request === selectionGeneration && isCurrentProjectSession(session)) get().setError(error)
    }
  },

  updateContent: (content) => set((state) => {
    if (!state.document || state.document.content === content) return state
    if (state.deletingNodes.includes(state.document.node.id)) return state
    if (isNodeLocked(state.data?.nodes ?? [], state.document.node.id)) return { error: '正文已锁定，请先解除本节点或父级锁定。' }
    return { document: { ...state.document, content }, documentVersion: state.documentVersion + 1, saveState: 'idle' }
  }),
  setEditorSelection: (selection) => set({ editorSelection: selection }),

  reloadConflictedDocument: async () => {
    const before = get(), session = captureProjectSession(), request = ++conflictGeneration
    if (!before.projectPath || !before.document || !before.error?.startsWith('EXTERNAL_CONFLICT:')) return false
    const current = () => request === conflictGeneration && isCurrentProjectSession(session) && get().document?.node.id === before.document!.node.id && get().documentVersion === before.documentVersion && get().document?.content === before.document!.content && get().error === before.error
    try {
      await projectApi.createHistorySnapshot({ projectPath: before.projectPath, nodeId: before.document.node.id, content: before.document.content, kind: 'protected', name: '读取外部版本前' })
      if (!current()) return false
      const fresh = await projectApi.getDocument({ projectPath: before.projectPath, nodeId: before.document.node.id })
      let applied = false
      set(state => {
        if (!current() || fresh.node.id !== before.document!.node.id) return state
        applied = true
        return { document: { ...fresh, persistedContent: fresh.content }, editorSelection: null, documentVersion: state.documentVersion + 1, saveState: 'saved', error: null }
      })
      return applied
    } catch (error) { if (current()) throw error; return false }
  },

  saveCurrentDocument: async (reason = '自动保存') => {
    const current = get()
    if (current.document && current.projectPath && current.saveState === 'saved' && /(?:切换|关闭).*前保存/u.test(reason)) {
      try {
        await projectApi.createHistorySnapshot({ projectPath: current.projectPath, nodeId: current.document.node.id, content: current.document.content, kind: 'checkpoint' })
        const after = get()
        if (after.projectSession !== current.projectSession || after.projectPath !== current.projectPath || after.document?.node.id !== current.document.node.id || after.documentVersion !== current.documentVersion || after.document.content !== current.document.content) throw new Error('保存版本期间正文或章节已变化，请重试切换或关闭。')
        return true
      } catch (error) { get().setError(error); return false }
    }
    if (isNodeLocked(current.data?.nodes ?? [], current.document?.node.id)) {
      if (current.saveState === 'saved') return true
      get().setError('正文已锁定，未保存的内容仍保留在编辑器，请先解锁。')
      return false
    }
    if (activeSave) {
      const saved = await activeSave
      if (!saved) return false
      if (get().saveState !== 'saved' || /(?:切换|关闭).*前保存/u.test(reason)) {
        if (get().projectSession !== current.projectSession || get().document?.node.id !== current.document?.node.id) return false
        return get().saveCurrentDocument(reason)
      }
      return true
    }
    activeSave = (async () => {
      while (true) {
        const { projectPath, document, documentVersion } = get()
        if (!projectPath || !document) return true
        const session = captureProjectSession()
        const savedProjectPath = projectPath
        const savedNodeId = document.node.id
        const savedContent = document.content
        set({ saveState: 'saving', error: null })
        try {
          const saved = await projectApi.saveDocument({
            projectPath: savedProjectPath, nodeId: savedNodeId, content: savedContent, reason, expectedContent: document.persistedContent,
          })
          if (!isCurrentProjectSession(session)) return true
          const current = get()
          const sameDocument = current.projectPath === savedProjectPath && current.document?.node.id === savedNodeId
          const sameVersion = sameDocument && current.documentVersion === documentVersion && current.document?.content === savedContent
          set((state) => ({
            document: sameDocument && state.document ? { ...state.document, persistedContent: saved.content, ...(sameVersion ? { node: saved.node, content: saved.content } : {}) } : state.document,
            saveState: sameVersion ? 'saved' : state.saveState,
            data: state.data ? { ...state.data, nodes: state.data.nodes.map((node) => node.id === saved.node.id ? saved.node : node) } : state.data,
          }))
          if (!sameDocument) return true
          if (!sameVersion) {
            set({ saveState: 'idle' })
            continue
          }
          if (saved.historyCreated) window.dispatchEvent(new Event('novelforge:history-changed'))
          void get().refreshStats()
          if (reason !== '自动保存' && isCurrentProjectSession(session)) notify({ message: '正文已保存', session: session.generation })
          return true
        } catch (error) {
          if (!isCurrentProjectSession(session) || get().document?.node.id !== savedNodeId) return false
          set({ saveState: 'error' })
          get().setError(error)
          if (String(error).includes('EXTERNAL_CONFLICT:')) {
            try { const recovery = await projectApi.listRecovery(savedProjectPath); if (isCurrentProjectSession(session)) set(state => ({ data: state.data ? { ...state.data, recovery } : null })) } catch { /* The saved copy path remains available in the conflict message. */ }
          }
          return false
        }
      }
    })().finally(() => { activeSave = null })
    return activeSave
  },

  refreshData: async (data, preserveSelection = true, session) => {
    if (data.project.id !== get().data?.project.id || (session && !isCurrentProjectSession(session))) return
    const current = get().document
    const currentNode = current ? data.nodes.find((node) => node.id === current.node.id) : undefined
    // A project mutation returns a fresh snapshot. Keep identical entity
    // references so unrelated updates do not reset component-owned drafts.
    const previous = new Map(get().data?.entities.map(entity => [entity.id, entity]) ?? [])
    const entities = data.entities.map(entity => {
      const existing = previous.get(entity.id)
      return existing && JSON.stringify(existing) === JSON.stringify(entity) ? existing : entity
    })
    set({
      data: { ...data, entities },
      error: null,
      document: current ? (currentNode ? { ...current, node: currentNode } : preserveSelection ? null : current) : null,
    })
  },

  createNode: async (kind, title, parentId) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      const previousChapterIds = new Set(get().data?.nodes.filter((node) => node.kind === 'chapter').map((node) => node.id) ?? [])
      let data = await projectApi.createNode({ projectPath, kind, title, parentId })
      if (!isCurrentProjectSession(session)) return
      await get().refreshData(data, true, session)
      if (kind === 'chapter') {
        const chapter = data.nodes.find((node) => node.kind === 'chapter' && !previousChapterIds.has(node.id))
        if (chapter) {
          try {
            data = await addInitialChecklist(projectPath, data, chapter)
            await get().refreshData(data, true, session)
          } catch (error) {
            if (isCurrentProjectSession(session)) get().setError(error)
          }
        }
      }
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error); throw error }
  },

  renameNode: async (nodeId, title) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    while (activeSave) { if (!await activeSave) return }
    if (!isCurrentProjectSession(session)) return
    if (get().document?.node.id === nodeId && get().saveState !== 'saved' && !await get().saveCurrentDocument('重命名前保存')) return
    if (!isCurrentProjectSession(session)) return
    if (get().document?.node.id === nodeId && !isCurrentDocumentSaved()) { get().setError('重命名前正文又有修改，请重试。'); return }
    const before = get().document?.node.id === nodeId ? get().document : null
    const rename = async () => {
      try {
        const data = await projectApi.renameNode({ projectPath, nodeId, title, expectedContent: before?.persistedContent ?? before?.content })
        if (!isCurrentProjectSession(session)) return true
        const renamed = data.renamedDocument
        if (before && renamed && get().document?.node.id === nodeId) {
          set(state => {
            const current = state.document!
            let content = current.content
            if (content === before.content) content = renamed.content
            else if (before.content.startsWith('# ')) {
              const end = before.content.indexOf('\n')
              const oldHeading = end < 0 ? before.content : before.content.slice(0, end)
              if (content.split('\n')[0] === oldHeading) content = renamed.content.split('\n')[0] + content.slice(oldHeading.length)
            } else if (!content.startsWith('# ') && renamed.content.endsWith(before.content)) {
              content = renamed.content.slice(0, renamed.content.length - before.content.length) + content
            }
            return { document: { ...renamed, content, persistedContent: renamed.content }, documentVersion: state.documentVersion + 1, saveState: content === renamed.content ? 'saved' : 'idle' }
          })
        }
        await get().refreshData(data, true, session)
        return true
      } catch (error) { if (isCurrentProjectSession(session)) get().setError(error); return false }
    }
    // Autosave must wait until the returned disk baseline has been applied.
    activeSave = rename().finally(() => { activeSave = null })
    await activeSave
  },

  setNodeStatus: async (nodeId, status) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      if (status === 'locked' && get().saveState !== 'saved' && !await get().saveCurrentDocument('锁定前保存')) throw new Error('正文保存失败，已取消锁定')
      if (!isCurrentProjectSession(session)) return
      await get().refreshData(await projectApi.setNodeStatus({ projectPath, nodeId, status }), true, session)
    }
    catch (error) { if (isCurrentProjectSession(session)) get().setError(error) }
  },

  reorderNode: async (nodeId, direction) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try { await get().refreshData(await projectApi.reorderNode({ projectPath, nodeId, direction }), true, session) }
    catch (error) { if (isCurrentProjectSession(session)) get().setError(error) }
  },

  moveNode: async (nodeId, targetParentId, targetOrderIndex) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      if (get().document && get().saveState !== 'saved') {
        const saved = await get().saveCurrentDocument('移动节点前保存')
        if (!saved) throw new Error('当前正文保存失败，已取消移动')
      }
      if (!isCurrentProjectSession(session)) return
      const data = await projectApi.moveNode({ projectPath, nodeId, targetParentId, targetOrderIndex })
      await get().refreshData(data, true, session)
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error); throw error }
  },

  copyNode: async (nodeId, targetParentId, title) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      if (get().document && get().saveState !== 'saved') {
        if (!await get().saveCurrentDocument('复制节点前保存')) throw new Error('当前正文保存失败，已取消复制')
      }
      if (!isCurrentProjectSession(session)) return
      const data = await projectApi.copyNode({ projectPath, nodeId, targetParentId, title })
      await get().refreshData(data, true, session)
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error); throw error }
  },

  deleteNode: async (nodeId) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath || get().deletingNodes.length) return
    const affected = new Set([nodeId])
    const nodes = get().data?.nodes ?? []
    for (let previous = -1; previous !== affected.size;) {
      previous = affected.size
      for (const node of nodes) if (node.parentId && affected.has(node.parentId)) affected.add(node.id)
    }
    const deletingNodes = [...affected]
    set({ deletingNodes })
    try {
      if (get().document && affected.has(get().document!.node.id)) {
        if (!await get().saveCurrentDocument('删除节点前保存')) throw new Error('当前正文保存失败，已取消删除')
        const document = get().document
        if (isCurrentProjectSession(session) && document && affected.has(document.node.id)) await projectApi.createHistorySnapshot({ projectPath, nodeId: document.node.id, content: document.content, kind: 'protected', name: '删除节点前' })
      }
      if (!isCurrentProjectSession(session)) return
      const data = await projectApi.deleteNode({ projectPath, nodeId })
      if (!isCurrentProjectSession(session)) return
      const current = get().document
      if (current && !data.nodes.some(node => node.id === current.node.id)) {
        set(state => ({ document: null, editorSelection: null, documentVersion: state.documentVersion + 1, saveState: 'saved' }))
        await get().refreshData(data, false, session)
        const next = firstChapter(data)
        if (next) await get().selectNode(next.id)
      } else {
        await get().refreshData(data, true, session)
      }
      if (isCurrentProjectSession(session)) notifyDeletion(nodeId, 'node', session)
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error); throw error }
    finally { if (get().deletingNodes === deletingNodes) set({ deletingNodes: [] }) }
  },

  selectEntity: (kind, entityId = null) => { if (get().activeView === kind && get().selectedEntityId === entityId) return; runGuarded(() => set({ activeView: kind, selectedEntityId: entityId })) },

  saveEntity: async (input) => {
    const session = captureProjectSession()
    if (input.projectPath !== session.path) throw new Error('项目已切换，请重新打开资料后保存')
    try {
      const data = await projectApi.upsertEntity(input)
      await get().refreshData(data, true, session)
      if (isCurrentProjectSession(session)) notify({ message: '资料已保存', session: session.generation })
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error); throw error }
  },

  deleteEntity: async (entityId) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      const data = await projectApi.deleteEntity({ projectPath, nodeId: entityId })
      if (!isCurrentProjectSession(session)) return
      await get().refreshData(data, false, session)
      set({ selectedEntityId: null })
      notifyDeletion(entityId, 'entity', session)
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error); throw error }
  },

  loadTrash: async () => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    set({ trashLoading: true, trashError: null })
    try { const trash = await projectApi.listTrash(projectPath); if (isCurrentProjectSession(session)) set({ trash }) }
    catch (error) { if (isCurrentProjectSession(session)) set({ trashError: String(error) }) }
    finally { if (isCurrentProjectSession(session)) set({ trashLoading: false }) }
  },

  restoreTrash: async (trashId) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      await get().refreshData(await projectApi.restoreTrash({ projectPath, nodeId: trashId }), false, session)
      if (isCurrentProjectSession(session)) await get().loadTrash()
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error) }
  },

  permanentlyDelete: async (trashId) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      await get().refreshData(await projectApi.permanentDelete({ projectPath, nodeId: trashId }), false, session)
      if (isCurrentProjectSession(session)) await get().loadTrash()
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error) }
  },

  emptyTrash: async () => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try {
      await get().refreshData(await projectApi.emptyTrash(projectPath), false, session)
      if (isCurrentProjectSession(session)) await get().loadTrash()
    } catch (error) { if (isCurrentProjectSession(session)) get().setError(error) }
  },

  runSearch: async (query, options) => {
    const session = captureProjectSession()
    const generation = ++searchGeneration
    const projectPath = get().projectPath
    const projectId = get().data?.project.id
    const isCurrent = () => isCurrentProjectSession(session) && generation === searchGeneration && get().projectPath === projectPath && get().data?.project.id === projectId && get().searchQuery === query
    set({ searchQuery: query, searchResults: [] })
    if (!projectPath || !query.trim()) {
      set({ searchResults: [] })
      return
    }
    try {
      const results = await projectApi.search({ projectPath, query, ...options })
      if (isCurrent()) set({ searchResults: results })
    } catch (error) { if (isCurrent()) get().setError(error) }
  },

  refreshStats: async () => {
    const generation = ++statsGeneration
    const session = captureProjectSession()
    const nodeId = get().document?.node.id
    const projectPath = get().projectPath
    if (!projectPath) return
    try { const stats = await projectApi.stats(projectPath, nodeId); if (generation === statsGeneration && isCurrentProjectSession(session) && get().document?.node.id === nodeId) set({ stats }) }
    catch (error) { if (isCurrentProjectSession(session)) get().setError(error) }
  },

  exportProject: async (format, options = {}) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) throw new Error('请先打开一个项目')
    if (get().document && get().saveState !== 'saved' && !await get().saveCurrentDocument('导出前保存')) throw new Error('当前正文保存失败，已取消导出')
    if (!isCurrentProjectSession(session)) throw new Error('项目已切换，已取消导出')
    return projectApi.exportProject({ projectPath, format, ...options })
  },

  updateProject: async (input) => {
    const session = captureProjectSession()
    const projectPath = get().projectPath
    if (!projectPath) return
    try { await get().refreshData(await projectApi.updateProject({ projectPath, ...input }), true, session); if (isCurrentProjectSession(session)) notify({ message: '作品信息已保存', session: session.generation }) }
    catch (error) { if (isCurrentProjectSession(session)) get().setError(error); throw error }
  },
}))

function notifyDeletion(refId: string, refKind: 'node' | 'entity', session: ReturnType<typeof captureProjectSession>) {
  notify({ message: refKind === 'node' ? '正文节点已移入回收站' : '资料已移入回收站', session: session.generation, undo: async () => {
    if (!isCurrentProjectSession(session) || !session.path) throw new Error('项目已切换，请到原项目的回收站恢复。')
    const items = await projectApi.listTrash(session.path)
    if (!isCurrentProjectSession(session)) throw new Error('项目已切换，已取消恢复。')
    const item = items.filter(item => item.refId === refId && item.refKind === refKind).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))[0]
    if (!item) throw new Error('未找到该回收条目，它可能已经恢复。')
    const data = await projectApi.restoreTrash({ projectPath: session.path, nodeId: item.id })
    await useAppStore.getState().refreshData(data, true, session)
    if (isCurrentProjectSession(session)) await useAppStore.getState().loadTrash()
  } })
}
