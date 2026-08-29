import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_PREFERENCES, normalizeWorkspacePreferences, readWorkspacePreferences,
  writeWorkspacePreferences,
} from '../src/lib/workspace-preferences'
import { cleanWritingWhitespace, indentParagraphs } from '../src/lib/markdown'

describe('workspace preferences', () => {
  beforeEach(() => localStorage.clear())

  it('clamps malformed persisted values and keeps defaults for missing fields', () => {
    const result = normalizeWorkspacePreferences({ sidebarWidth: 9999, editorLineHeight: 0, editorFontFamily: 'other' })
    expect(result.sidebarWidth).toBe(420)
    expect(result.editorLineHeight).toBe(1.4)
    expect(result.editorFontFamily).toBe('serif')
    expect(result.inspectorWidth).toBe(DEFAULT_WORKSPACE_PREFERENCES.inspectorWidth)
  })

  it('round-trips preferences through localStorage', () => {
    writeWorkspacePreferences({ ...DEFAULT_WORKSPACE_PREFERENCES, sidebarWidth: 350, editorFontFamily: 'sans' })
    expect(readWorkspacePreferences().sidebarWidth).toBe(350)
    expect(readWorkspacePreferences().editorFontFamily).toBe('sans')
  })
})

describe('writing cleanup helpers', () => {
  it('removes trailing spaces and collapses excessive blank lines', () => {
    expect(cleanWritingWhitespace('第一行  \n\n\n\n第二行\t')).toBe('第一行\n\n第二行')
  })

  it('indents only the first line of ordinary paragraphs', () => {
    expect(indentParagraphs('第一段第一行\n第一段第二行\n\n# 标题\n\n- 列表')).toBe('　　第一段第一行\n第一段第二行\n\n# 标题\n\n- 列表')
  })
})
