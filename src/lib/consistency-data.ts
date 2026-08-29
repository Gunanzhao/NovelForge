import { wikiTargets } from './markdown'
import { chapterReferenceTokens, findChapterByReference } from './planning-data'
import type { ConsistencyIssue, ConsistencyReport, EntityRecord, NodeRecord, ProjectData } from './types'

function entityValue(entity: EntityRecord, key: string) {
  const value = entity.content[key]
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function issue(
  severity: ConsistencyIssue['severity'], code: string, title: string, detail: string,
  refId: string, refKind: string, path: string,
): ConsistencyIssue {
  return { id: `${code}:${refId}:${title}`, severity, code, title, detail, refId, refKind, path }
}

function chapterReferenceExists(chapters: NodeRecord[], value: string) {
  return Boolean(findChapterByReference(chapters, value))
}

export function analyzeConsistency(data: ProjectData, documents: Record<string, string>): ConsistencyReport {
  const issues: ConsistencyIssue[] = []
  const activeEntities = data.entities
  const chapters = data.nodes.filter((node) => node.kind === 'chapter')
  const knownTitles = new Set(activeEntities.map((entity) => entity.title.trim()).filter(Boolean))
  const duplicateTitles = new Map<string, EntityRecord>()

  for (const entity of activeEntities) {
    const title = entity.title.trim()
    if (!title) {
      issues.push(issue('error', 'empty-title', '资料条目没有名称', '请为资料条目补充名称，避免 Wiki 链接和搜索结果无法定位。', entity.id, 'entity', entity.filePath))
      continue
    }
    const duplicateKey = `${entity.kind}:${title.toLocaleLowerCase()}`
    if (duplicateTitles.has(duplicateKey)) {
      issues.push(issue('warning', 'duplicate-title', '资料条目名称重复', `“${title}”在同一资料类型中出现多次，Wiki 链接可能指向不明确。`, entity.id, 'entity', entity.filePath))
    } else {
      duplicateTitles.set(duplicateKey, entity)
    }
  }

  for (const node of data.nodes.filter((candidate) => candidate.kind !== 'volume')) {
    const content = documents[node.id] ?? ''
    for (const target of wikiTargets(content)) {
      if (!knownTitles.has(target)) {
        issues.push(issue('warning', 'missing-wiki', 'Wiki 链接没有对应资料', `正文引用了“${target}”，但资料库中没有同名条目。`, node.id, node.kind, node.filePath))
      }
    }
  }

  const characterIds = new Set(activeEntities.filter((entity) => entity.kind === 'character').map((entity) => entity.id))
  for (const entity of activeEntities.filter((candidate) => candidate.kind === 'relationship')) {
    const fromId = entityValue(entity, 'fromId')
    const toId = entityValue(entity, 'toId')
    if (!characterIds.has(fromId) || !characterIds.has(toId)) {
      issues.push(issue('error', 'broken-relationship', '人物关系引用失效', '关系两端必须指向仍存在的人物资料。', entity.id, 'relationship', entity.filePath))
    }
    if (fromId && fromId === toId) {
      issues.push(issue('warning', 'self-relationship', '人物关系连接到自身', '请确认这是否是有意记录的自我关系。', entity.id, 'relationship', entity.filePath))
    }
  }

  const chapterReferenceFields: Array<{ kind: string; key: string; label: string }> = [
    { kind: 'timeline', key: 'chapters', label: '关联章节' },
    { kind: 'foreshadowing', key: 'plantedIn', label: '首次埋设章节' },
    { kind: 'foreshadowing', key: 'plannedPayoff', label: '计划回收章节' },
    { kind: 'foreshadowing', key: 'actualPayoff', label: '实际回收章节' },
  ]
  for (const entity of activeEntities) {
    for (const field of chapterReferenceFields.filter((candidate) => candidate.kind === entity.kind)) {
      for (const reference of chapterReferenceTokens(entityValue(entity, field.key))) {
        if (!chapterReferenceExists(chapters, reference)) {
          issues.push(issue('warning', 'missing-chapter-reference', `${field.label}不存在`, `“${reference}”无法匹配当前正文中的章节。`, entity.id, entity.kind, entity.filePath))
        }
      }
    }
    if (entity.kind === 'foreshadowing') {
      const status = entityValue(entity, 'status').trim().toLocaleLowerCase()
      const actualPayoff = entityValue(entity, 'actualPayoff').trim()
      if (actualPayoff && status !== 'paid-off' && status !== '已回收') {
        issues.push(issue('warning', 'foreshadowing-status', '伏笔状态未标记为已回收', '已经填写实际回收章节，但当前状态仍未标记为“已回收”。', entity.id, entity.kind, entity.filePath))
      }
    }
  }

  const errors = issues.filter((item) => item.severity === 'error').length
  const warnings = issues.filter((item) => item.severity === 'warning').length
  return { checkedAt: new Date().toISOString(), issueCount: issues.length, errors, warnings, issues }
}
