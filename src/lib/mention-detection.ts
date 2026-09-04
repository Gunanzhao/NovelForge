import type { EntityRecord } from './types'

export type MentionKind = 'character' | 'location' | 'world'
export type MentionStatus = 'known' | 'candidate' | 'ignored'

export interface MentionCandidate {
  id: string
  text: string
  kind: MentionKind
  start: number
  end: number
  entityId?: string
  status: MentionStatus
  confidence: number
}

export interface MentionDocument {
  nodeId: string
  content: string
}

export interface MentionIndex {
  byDocument: Record<string, MentionCandidate[]>
  byEntity: Record<string, Array<{ nodeId: string; count: number }>>
}

interface Range {
  start: number
  end: number
}

const MENTION_KINDS = new Set<MentionKind>(['character', 'location', 'world'])
const LOCATION_SUFFIXES = [
  '酒馆', '客栈', '学校', '学院', '医院', '车站', '码头', '广场', '森林', '山脉',
  '港', '城', '镇', '村', '山', '河', '湖', '岛', '宫', '塔', '街', '路', '国', '府', '院', '店', '站',
]
const WORLD_SUFFIXES = ['魔法', '法术', '秘术', '剑术', '教会', '联盟', '帝国', '王国', '纪元', '法则', '系统', '族']
const LOCATION_LEADING_VERBS = ['推开', '走进', '来到', '进入', '离开', '看见', '抵达', '返回', '前往', '穿过', '住在', '赶到']
const WORLD_LEADING_VERBS = ['学习', '使用', '施展', '掌握', '研究', '信奉', '遵循', '发现']
const CANDIDATE_STOP_WORDS = new Set([
  '先生', '老师', '今天', '城市', '这里', '那里', '自己', '他们', '她们', '我们', '你们',
])

function addRange(ranges: Range[], start: number, end: number) {
  if (end > start) ranges.push({ start, end })
}

function protectedMarkdownRanges(content: string): Range[] {
  const ranges: Range[] = []
  const wholePatterns = [
    /```[\s\S]*?(?:```|$)/gu,
    /~~~[\s\S]*?(?:~~~|$)/gu,
    /`[^`\n]*`/gu,
    /\[\[[^\]\n]+\]\]/gu,
    /\b(?:https?:\/\/|mailto:)[^\s<>)\]]+/giu,
  ]
  for (const pattern of wholePatterns) {
    for (const match of content.matchAll(pattern)) addRange(ranges, match.index, match.index + match[0].length)
  }
  const markdownDestination = /!?\[[^\]\n]*\]\(([^)\n]*)\)/gu
  for (const match of content.matchAll(markdownDestination)) {
    const destination = match[1]
    const offset = match[0].indexOf(destination)
    addRange(ranges, match.index + offset, match.index + offset + destination.length)
  }
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end)
}

function overlapsRange(start: number, end: number, ranges: Range[]) {
  return ranges.some((range) => start < range.end && end > range.start)
}

function aliases(entity: EntityRecord) {
  const raw = entity.content.alias ?? entity.content.aliases
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,，、;；/\n]/u) : []
  return values.map((value) => String(value).trim()).filter(Boolean)
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase()
}

function hasLatinBoundary(content: string, start: number, end: number) {
  const previous = content[start - 1] ?? ''
  const next = content[end] ?? ''
  return !/[A-Za-z0-9_]/u.test(previous) && !/[A-Za-z0-9_]/u.test(next)
}

function findAll(content: string, term: string) {
  const locations: Array<{ start: number; end: number }> = []
  const source = /[A-Za-z]/u.test(term) ? content.toLocaleLowerCase() : content
  const needle = /[A-Za-z]/u.test(term) ? term.toLocaleLowerCase() : term
  let from = 0
  while (needle && from < source.length) {
    const start = source.indexOf(needle, from)
    if (start < 0) break
    const end = start + needle.length
    if (!/[A-Za-z]/u.test(term) || hasLatinBoundary(content, start, end)) locations.push({ start, end })
    from = Math.max(end, start + 1)
  }
  return locations
}

function trimCandidate(raw: string, absoluteStart: number) {
  let text = raw
  let start = absoluteStart
  for (const verb of LOCATION_LEADING_VERBS) {
    const index = text.lastIndexOf(verb)
    if (index >= 0) {
      start += index + verb.length
      text = text.slice(index + verb.length)
    }
  }
  const leading = text.match(/^(?:她|他|它|我|你|我们|他们|她们|随后|然后|终于|已经|再次|向着|朝着)/u)?.[0] ?? ''
  return { text: text.slice(leading.length), start: start + leading.length }
}

function candidateMatches(content: string, protectedRanges: Range[]) {
  const matches: MentionCandidate[] = []
  const add = (text: string, kind: MentionKind, start: number, confidence: number) => {
    const clean = text.trim()
    const trimOffset = text.indexOf(clean)
    const actualStart = start + Math.max(0, trimOffset)
    const end = actualStart + clean.length
    if (clean.length < 2 || CANDIDATE_STOP_WORDS.has(clean) || overlapsRange(actualStart, end, protectedRanges)) return
    matches.push({
      id: `${kind}:${actualStart}:${end}:${clean}`,
      text: clean,
      kind,
      start: actualStart,
      end,
      status: 'candidate',
      confidence,
    })
  }

  const characterPattern = /([\p{Script=Han}]{2,4})(?=说|问|道|看向|看见|走进|走出|推开|打开|来到|进入|笑|哭|点头|摇头)/gu
  for (const match of content.matchAll(characterPattern)) add(match[1], 'character', match.index, 0.72)

  const englishCharacterPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=\s+(?:said|asked|walked|opened|entered|smiled|cried)\b)/gu
  for (const match of content.matchAll(englishCharacterPattern)) add(match[1], 'character', match.index, 0.7)

  const locationPattern = new RegExp(`[\\p{Script=Han}]{1,10}(?:${LOCATION_SUFFIXES.join('|')})`, 'gu')
  for (const match of content.matchAll(locationPattern)) {
    const candidate = trimCandidate(match[0], match.index)
    add(candidate.text, 'location', candidate.start, 0.68)
  }

  const worldPattern = new RegExp(`[《“「『]?([\\p{Script=Han}]{1,8}(?:${WORLD_SUFFIXES.join('|')}))[》”」』]?`, 'gu')
  for (const match of content.matchAll(worldPattern)) {
    let inner = match[1]
    let start = match.index + match[0].indexOf(inner)
    for (const verb of WORLD_LEADING_VERBS) {
      const index = inner.lastIndexOf(verb)
      if (index >= 0) {
        start += index + verb.length
        inner = inner.slice(index + verb.length)
      }
    }
    add(inner, 'world', start, 0.62)
  }
  return matches
}

function preferNonOverlapping(candidates: MentionCandidate[]) {
  const accepted: MentionCandidate[] = []
  const ranked = candidates.slice().sort((left, right) => {
    const status = (left.status === 'known' ? 0 : 1) - (right.status === 'known' ? 0 : 1)
    if (status) return status
    const length = (right.end - right.start) - (left.end - left.start)
    return length || left.start - right.start || left.kind.localeCompare(right.kind)
  })
  for (const candidate of ranked) {
    if (!accepted.some((item) => candidate.start < item.end && candidate.end > item.start)) accepted.push(candidate)
  }
  return accepted.sort((left, right) => left.start - right.start || left.end - right.end)
}

export function scanMentions(
  content: string,
  entities: EntityRecord[],
  ignoredTexts: Iterable<string> = [],
): MentionCandidate[] {
  const protectedRanges = protectedMarkdownRanges(content)
  const ignored = new Set([...ignoredTexts].map(normalized))
  const known: MentionCandidate[] = []
  for (const entity of entities) {
    if (!MENTION_KINDS.has(entity.kind as MentionKind)) continue
    const terms = [entity.title, ...aliases(entity)]
      .map((term) => term.trim())
      .filter((term, index, all) => term.length >= 2 && all.indexOf(term) === index)
      .sort((left, right) => right.length - left.length)
    for (const term of terms) {
      for (const location of findAll(content, term)) {
        if (overlapsRange(location.start, location.end, protectedRanges)) continue
        known.push({
          id: `${entity.kind}:${location.start}:${location.end}:${term}`,
          text: content.slice(location.start, location.end),
          kind: entity.kind as MentionKind,
          start: location.start,
          end: location.end,
          entityId: entity.id,
          status: ignored.has(normalized(term)) ? 'ignored' : 'known',
          confidence: 1,
        })
      }
    }
  }
  const candidates = candidateMatches(content, protectedRanges).map((candidate) => (
    ignored.has(normalized(candidate.text)) ? { ...candidate, status: 'ignored' as const } : candidate
  ))
  return preferNonOverlapping([...known, ...candidates])
}

export function buildMentionIndex(
  documents: MentionDocument[],
  entities: EntityRecord[],
  ignoredTexts: Iterable<string> = [],
): MentionIndex {
  const byDocument: Record<string, MentionCandidate[]> = {}
  const byEntity: MentionIndex['byEntity'] = {}
  for (const document of documents) {
    const mentions = scanMentions(document.content, entities, ignoredTexts)
    byDocument[document.nodeId] = mentions
    const counts = new Map<string, number>()
    for (const mention of mentions) {
      if (mention.status === 'known' && mention.entityId) counts.set(mention.entityId, (counts.get(mention.entityId) ?? 0) + 1)
    }
    for (const [entityId, count] of counts) {
      const records = byEntity[entityId] ?? []
      records.push({ nodeId: document.nodeId, count })
      byEntity[entityId] = records
    }
  }
  return { byDocument, byEntity }
}

export function insertMentionWiki(content: string, mention: MentionCandidate) {
  if (mention.start < 0 || mention.end > content.length || mention.start >= mention.end) return content
  if (content.slice(mention.start, mention.end) !== mention.text) return content
  return `${content.slice(0, mention.start)}[[${mention.text}]]${content.slice(mention.end)}`
}
