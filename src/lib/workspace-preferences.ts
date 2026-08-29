export type EditorFontFamily = 'serif' | 'sans'

export interface WorkspacePreferences {
  sidebarWidth: number
  inspectorWidth: number
  editorFontFamily: EditorFontFamily
  editorFontSize: number
  editorLineHeight: number
  contentWidth: number
  paragraphSpacing: number
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  sidebarWidth: 272,
  inspectorWidth: 278,
  editorFontFamily: 'serif',
  editorFontSize: 14,
  editorLineHeight: 1.95,
  contentWidth: 920,
  paragraphSpacing: 15,
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
    sidebarWidth: finiteNumber(source.sidebarWidth, DEFAULT_WORKSPACE_PREFERENCES.sidebarWidth, 220, 420, true),
    inspectorWidth: finiteNumber(source.inspectorWidth, DEFAULT_WORKSPACE_PREFERENCES.inspectorWidth, 220, 420, true),
    editorFontFamily: source.editorFontFamily === 'sans' ? 'sans' : 'serif',
    editorFontSize: finiteNumber(source.editorFontSize, DEFAULT_WORKSPACE_PREFERENCES.editorFontSize, 12, 22, true),
    editorLineHeight: finiteNumber(source.editorLineHeight, DEFAULT_WORKSPACE_PREFERENCES.editorLineHeight, 1.4, 2.6),
    contentWidth: finiteNumber(source.contentWidth, DEFAULT_WORKSPACE_PREFERENCES.contentWidth, 560, 1200, true),
    paragraphSpacing: finiteNumber(source.paragraphSpacing, DEFAULT_WORKSPACE_PREFERENCES.paragraphSpacing, 0, 40, true),
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
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeWorkspacePreferences(preferences)))
  } catch {
    // 偏好写入失败不阻断正文编辑。
  }
}
