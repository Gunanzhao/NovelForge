import { describe, expect, it } from 'vitest'
import { commandView, defaultShortcutMap, normalizeShortcut, readShortcutMap, shortcutFromKeyboardEvent, writeShortcutMap } from '../src/lib/command-registry'
import { buildRelationshipGraph, relationshipDetails, relationshipTitle } from '../src/lib/relationship-data'
import type { EntityRecord } from '../src/lib/types'

function character(id: string, title: string): EntityRecord {
  return { id, kind: 'character', title, content: {}, tags: [], filePath: `characters/${id}.md`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
}

function relationship(id: string, fromId: string, toId: string, label: string): EntityRecord {
  return { id, kind: 'relationship', title: label, content: { fromId, toId, label, strength: '强', notes: '测试备注' }, tags: [], filePath: `relationships/${id}.md`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
}

describe('relationship graph helpers', () => {
  it('lays out characters and ignores dangling or self links', () => {
    const characters = [character('a', '林月'), character('b', '沈砚'), character('c', '守门人')]
    const graph = buildRelationshipGraph(characters, [relationship('ab', 'a', 'b', '盟友'), relationship('dangling', 'a', 'missing', '未知'), relationship('self', 'a', 'a', '自我')])
    expect(graph.nodes).toHaveLength(3)
    expect(graph.links.map((link) => link.id)).toEqual(['ab'])
    expect(graph.nodes.find((node) => node.id === 'a')?.degree).toBe(1)
    expect(new Set(graph.nodes.map((node) => `${node.x},${node.y}`)).size).toBe(3)
  })

  it('normalizes relationship content and titles', () => {
    const item = relationship('ab', 'a', 'b', '盟友')
    expect(relationshipDetails(item)).toMatchObject({ fromId: 'a', toId: 'b', label: '盟友', strength: '强' })
    expect(relationshipTitle('林月', '沈砚', '盟友')).toBe('林月 · 盟友 · 沈砚')
  })
})

describe('command registry', () => {
  it('normalizes shortcuts, maps views and persists custom bindings', () => {
    expect(normalizeShortcut('control+shift+p')).toBe('Ctrl+Shift+P')
    expect(commandView('open-relationship')).toBe('relationship')
    const defaults = defaultShortcutMap()
    expect(defaults['quick-inbox']).toBe('Ctrl+Shift+I')
    expect(defaults['toggle-bold']).toBe('Ctrl+B')
    expect(defaults['toggle-italic']).toBe('Ctrl+I')
    defaults['open-relationship'] = 'Ctrl+Alt+R'
    writeShortcutMap(defaults)
    expect(readShortcutMap()['open-relationship']).toBe('Ctrl+Alt+R')
  })

  it('converts keyboard events to stable Windows-style shortcuts', () => {
    expect(shortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))).toBe('Ctrl+S')
    expect(shortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 'F11' }))).toBe('F11')
    expect(shortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))).toBe('')
    expect(shortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 'a' }))).toBe('')
  })
})
