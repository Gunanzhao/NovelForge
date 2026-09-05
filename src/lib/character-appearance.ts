import { projectApi } from './api'
import { buildMentionIndex } from './mention-detection'
import type { MentionIndex } from './mention-detection'
import { sortChapterNodes } from './planning-data'
import type { EntityRecord, NodeRecord, ProjectData } from './types'

export interface AppearanceChapter {
  node: NodeRecord
  mentions: number
}

export interface AppearanceCompanion {
  entity: EntityRecord
  chapters: number
}

export interface CharacterAppearance {
  character: EntityRecord
  firstChapter?: NodeRecord
  recentChapter?: NodeRecord
  chapters: AppearanceChapter[]
  totalMentions: number
  companions: AppearanceCompanion[]
  locations: AppearanceCompanion[]
}

export interface ChapterMentionRow {
  chapter: NodeRecord
  entityIds: Set<string>
  counts: Map<string, number>
}

interface CachedIndex {
  signature: string
  index: MentionIndex
}

const projectCache = new Map<string, CachedIndex>()
const pendingScans = new Map<string, symbol>()

function ignoreTexts(entities: EntityRecord[]) {
  return entities
    .filter((entity) => entity.kind === 'mention-ignore')
    .map((entity) => typeof entity.content.text === 'string' ? entity.content.text : entity.title)
}

function indexSignature(data: ProjectData) {
  const nodes = data.nodes.filter((node) => node.kind !== 'volume').map((node) => `${node.id}:${node.updatedAt}`).join('|')
  const entities = data.entities.map((entity) => `${entity.id}:${entity.updatedAt}`).join('|')
  return `${data.project.id}|${nodes}|${entities}`
}

export async function scanProjectMentionIndex(projectPath: string, data: ProjectData, force = false) {
  const signature = indexSignature(data)
  const cached = projectCache.get(projectPath)
  if (!force && cached?.signature === signature) return cached.index
  const request = Symbol(projectPath)
  pendingScans.set(projectPath, request)
  const nodes = data.nodes.filter((node) => node.kind === 'chapter' || node.kind === 'section')
  const documents: Array<{ nodeId: string; content: string }> = []
  const batchSize = 20
  for (let start = 0; start < nodes.length; start += batchSize) {
    const batch = nodes.slice(start, start + batchSize)
    const loaded = await Promise.all(batch.map(async (node) => {
      const document = await projectApi.getDocument({ projectPath, nodeId: node.id })
      return { nodeId: node.id, content: document.content }
    }))
    documents.push(...loaded)
  }
  const index = buildMentionIndex(documents, data.entities, ignoreTexts(data.entities))
  if (pendingScans.get(projectPath) === request) {
    projectCache.set(projectPath, { signature, index })
    pendingScans.delete(projectPath)
  }
  return index
}

export function clearProjectMentionIndex(projectPath?: string) {
  if (projectPath) { projectCache.delete(projectPath); pendingScans.delete(projectPath) }
  else { projectCache.clear(); pendingScans.clear() }
}

function chapterForNode(nodes: NodeRecord[], nodeId: string) {
  const node = nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return undefined
  if (node.kind === 'chapter') return node
  if (node.kind === 'section') return nodes.find((candidate) => candidate.id === node.parentId && candidate.kind === 'chapter')
  return undefined
}

export function chapterMentionRows(data: ProjectData, index: MentionIndex): ChapterMentionRow[] {
  const rows = new Map<string, ChapterMentionRow>()
  for (const chapter of sortChapterNodes(data.nodes)) {
    rows.set(chapter.id, { chapter, entityIds: new Set(), counts: new Map() })
  }
  for (const [nodeId, mentions] of Object.entries(index.byDocument)) {
    const chapter = chapterForNode(data.nodes, nodeId)
    const row = chapter ? rows.get(chapter.id) : undefined
    if (!row) continue
    for (const mention of mentions) {
      if (mention.status !== 'known' || !mention.entityId) continue
      row.entityIds.add(mention.entityId)
      row.counts.set(mention.entityId, (row.counts.get(mention.entityId) ?? 0) + 1)
    }
  }
  return [...rows.values()]
}

export function buildCharacterAppearance(data: ProjectData, index: MentionIndex, characterId: string): CharacterAppearance | null {
  const character = data.entities.find((entity) => entity.id === characterId && entity.kind === 'character')
  if (!character) return null
  const rows = chapterMentionRows(data, index)
  const chapters = rows
    .filter((row) => row.entityIds.has(characterId))
    .map((row) => ({ node: row.chapter, mentions: row.counts.get(characterId) ?? 0 }))
  const companionCounts = new Map<string, number>()
  const locationCounts = new Map<string, number>()
  for (const row of rows.filter((candidate) => candidate.entityIds.has(characterId))) {
    for (const entityId of row.entityIds) {
      if (entityId === characterId) continue
      const entity = data.entities.find((candidate) => candidate.id === entityId)
      if (entity?.kind === 'character') companionCounts.set(entityId, (companionCounts.get(entityId) ?? 0) + 1)
      if (entity?.kind === 'location') locationCounts.set(entityId, (locationCounts.get(entityId) ?? 0) + 1)
    }
  }
  const ranked = (counts: Map<string, number>): AppearanceCompanion[] => [...counts.entries()]
    .flatMap(([id, count]) => {
      const entity = data.entities.find((candidate) => candidate.id === id)
      return entity ? [{ entity, chapters: count }] : []
    })
    .sort((left, right) => right.chapters - left.chapters || left.entity.title.localeCompare(right.entity.title, 'zh-CN'))
  return {
    character,
    firstChapter: chapters[0]?.node,
    recentChapter: chapters.at(-1)?.node,
    chapters,
    totalMentions: chapters.reduce((sum, chapter) => sum + chapter.mentions, 0),
    companions: ranked(companionCounts),
    locations: ranked(locationCounts),
  }
}

export function matrixWindow<T>(items: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.max(0, Math.min(page, pageCount - 1))
  return { items: items.slice(safePage * pageSize, (safePage + 1) * pageSize), page: safePage, pageCount }
}
