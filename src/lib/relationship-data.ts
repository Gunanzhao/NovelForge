import type { EntityRecord } from './types'

export interface RelationshipDetails {
  fromId: string
  toId: string
  label: string
  strength: string
  notes: string
}

export interface RelationshipGraphNode {
  id: string
  title: string
  x: number
  y: number
  degree: number
}

export interface RelationshipGraphLink {
  id: string
  fromId: string
  toId: string
  label: string
  strength: string
}

export interface RelationshipGraph {
  nodes: RelationshipGraphNode[]
  links: RelationshipGraphLink[]
  width: number
  height: number
}

function valueText(entity: EntityRecord | undefined, key: string) {
  const value = entity?.content[key]
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export function relationshipDetails(entity: EntityRecord | undefined): RelationshipDetails {
  return {
    fromId: valueText(entity, 'fromId'),
    toId: valueText(entity, 'toId'),
    label: valueText(entity, 'label'),
    strength: valueText(entity, 'strength'),
    notes: valueText(entity, 'notes'),
  }
}

export function relationshipTitle(fromTitle: string, toTitle: string, label: string) {
  const relation = label.trim() || '关系'
  return `${fromTitle.trim() || '未命名人物'} · ${relation} · ${toTitle.trim() || '未命名人物'}`
}

export function buildRelationshipGraph(characters: EntityRecord[], relationships: EntityRecord[]): RelationshipGraph {
  const characterIds = new Set(characters.map((character) => character.id))
  const validLinks = relationships.map((relationship) => {
    const details = relationshipDetails(relationship)
    if (!characterIds.has(details.fromId) || !characterIds.has(details.toId) || details.fromId === details.toId) return null
    return {
      id: relationship.id,
      fromId: details.fromId,
      toId: details.toId,
      label: details.label || '关系',
      strength: details.strength,
    }
  }).filter((link): link is RelationshipGraphLink => link !== null)

  const degrees = new Map<string, number>(characters.map((character) => [character.id, 0]))
  for (const link of validLinks) {
    degrees.set(link.fromId, (degrees.get(link.fromId) ?? 0) + 1)
    degrees.set(link.toId, (degrees.get(link.toId) ?? 0) + 1)
  }
  const orderedCharacters = [...characters].sort((left, right) => {
    const degree = (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0)
    return degree || left.title.localeCompare(right.title, 'zh-CN')
  })
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.max(1, orderedCharacters.length)))))
  const cellWidth = 190
  const cellHeight = 122
  const paddingX = 100
  const paddingY = 70
  const rows = Math.max(1, Math.ceil(orderedCharacters.length / columns))
  const width = Math.max(640, paddingX * 2 + Math.max(0, columns - 1) * cellWidth + 140)
  const height = Math.max(300, paddingY * 2 + Math.max(0, rows - 1) * cellHeight + 90)
  const nodes = orderedCharacters.map((character, index) => ({
    id: character.id,
    title: character.title,
    x: paddingX + (index % columns) * cellWidth,
    y: paddingY + Math.floor(index / columns) * cellHeight,
    degree: degrees.get(character.id) ?? 0,
  }))
  return { nodes, links: validLinks, width, height }
}

