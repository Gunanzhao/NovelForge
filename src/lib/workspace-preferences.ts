export type EditorFontFamily = 'serif' | 'sans'

export interface WorkspacePreferences {
  autoRecognizeNames?: boolean
  sidebarWidth: number
  inspectorWidth: number
  sidebarOpen: boolean
  inspectorOpen: boolean
  editorFontFamily: EditorFontFamily
  editorFontSize: number
  editorLineHeight: number
  contentWidth: number
  paragraphSpacing: number
  dailyTargetWords: number
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  autoRecognizeNames: true,
  sidebarWidth: 272,
  inspectorWidth: 278,
  sidebarOpen: true,
  inspectorOpen: true,
  editorFontFamily: 'serif',
  editorFontSize: 14,
  editorLineHeight: 1.95,
  contentWidth: 920,
  paragraphSpacing: 15,
  dailyTargetWords: 1500,
}

export const WORKSPACE_PREFERENCES_STORAGE_KEY = 'novelforge:workspace-preferences:v1'

function finiteNumber(value: unknown, fallback: number, min: number, max: number, integer = false) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.min(max, Math.max(min, number))
  return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100
}

export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    autoRecognizeNames: source.autoRecognizeNames !== false,
    sidebarWidth: finiteNumber(source.sidebarWidth, DEFAULT_WORKSPACE_PREFERENCES.sidebarWidth, 220, 420, true),
    inspectorWidth: finiteNumber(source.inspectorWidth, DEFAULT_WORKSPACE_PREFERENCES.inspectorWidth, 220, 420, true),
    sidebarOpen: typeof source.sidebarOpen === 'boolean' ? source.sidebarOpen : DEFAULT_WORKSPACE_PREFERENCES.sidebarOpen,
    inspectorOpen: typeof source.inspectorOpen === 'boolean' ? source.inspectorOpen : DEFAULT_WORKSPACE_PREFERENCES.inspectorOpen,
    editorFontFamily: source.editorFontFamily === 'sans' ? 'sans' : 'serif',
    editorFontSize: finiteNumber(source.editorFontSize, DEFAULT_WORKSPACE_PREFERENCES.editorFontSize, 12, 22, true),
    editorLineHeight: finiteNumber(source.editorLineHeight, DEFAULT_WORKSPACE_PREFERENCES.editorLineHeight, 1.4, 2.6),
    contentWidth: finiteNumber(source.contentWidth, DEFAULT_WORKSPACE_PREFERENCES.contentWidth, 560, 1200, true),
    paragraphSpacing: finiteNumber(source.paragraphSpacing, DEFAULT_WORKSPACE_PREFERENCES.paragraphSpacing, 0, 40, true),
    dailyTargetWords: finiteNumber(source.dailyTargetWords, DEFAULT_WORKSPACE_PREFERENCES.dailyTargetWords, 0, 100_000, true),
  }
}

export function readWorkspacePreferences(): WorkspacePreferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_WORKSPACE_PREFERENCES }
  try {
    return normalizeWorkspacePreferences(JSON.parse(localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}'))
  } catch {
    return { ...DEFAULT_WORKSPACE_PREFERENCES }
  }
}

export function writeWorkspacePreferences(preferences: WorkspacePreferences) {
  if (typeof localStorage === 'undefined') return false
  try {
    localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeWorkspacePreferences(preferences)))
    return true
  } catch {
    return false
  }
}

/** Fit visible panels without losing the user's preferred widths. */
export function fitWorkspaceColumns(preferences: WorkspacePreferences, viewportWidth: number, sidebarOpen: boolean, inspectorOpen: boolean) {
  const normalized = normalizeWorkspacePreferences(preferences)
  const sidebar = sidebarOpen ? normalized.sidebarWidth : 0
  const inspector = inspectorOpen ? normalized.inspectorWidth : 0
  const available = Math.max(0, viewportWidth - 480)
  const total = sidebar + inspector
  if (total <= available) return { sidebar, inspector }
  const fittedSidebar = total ? Math.floor(sidebar / total * available) : 0
  return { sidebar: fittedSidebar, inspector: Math.max(0, available - fittedSidebar) }
}
