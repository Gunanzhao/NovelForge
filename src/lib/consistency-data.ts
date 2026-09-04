import { wikiTargets } from './markdown'
import { chapterReferenceTokens, findChapterByReference, normalizeForeshadowingStatus } from './planning-data'
import type { ConsistencyIssue, ConsistencyReport, EntityRecord, NodeRecord, ProjectData } from './types'
import { storyArcHealthIssues } from './story-arc-data'

function entityValue(entity: EntityRecord, key: string) {
  const value = entity.content[key]
  return valueText(value)
}

function valueText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => valueText(item)).filter(Boolean).join('、')
  return ''
}

function normalizedKey(value: string) {
  return value.replace(/[\s_-]+/gu, '').toLocaleLowerCase()
}

function fieldValues(entity: EntityRecord, keys: string[]) {
  const expected = new Set(keys.map(normalizedKey))
  return Object.entries(entity.content)
    .filter(([key]) => expected.has(normalizedKey(key)))
    .map(([, value]) => value)
}

function nestedValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => nestedValues(item))
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => nestedValues(item))
  return [value]
}

function numericValues(values: unknown[]) {
  return values.flatMap((value) => nestedValues(value)).flatMap((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return [value]
    if (typeof value !== 'string') return []
    return [...value.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match) => Number(match[0])).filter(Number.isFinite)
  })
}

function distinctNumbers(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))]
}

function normalizedText(value: string) {
  return value.trim().toLocaleLowerCase()
}

function splitStructuredText(value: unknown) {
  return valueText(value).split(/[,，、;；/|]+/u).map((item) => item.trim()).filter(Boolean)
}

function entityAliases(entity: EntityRecord) {
  return [entity.id, entity.title, ...fieldValues(entity, ['alias', 'aliases']).flatMap(splitStructuredText)]
    .map((value) => value.trim())
    .filter(Boolean)
}

function mentionsEntity(value: unknown, entity: EntityRecord) {
  const text = valueText(value).trim()
  if (!text) return false
  const normalized = normalizedText(text)
  return entityAliases(entity).some((alias) => normalizedText(alias) === normalized || normalized.includes(normalizedText(alias)))
}

function parseChronology(value: unknown): number | null {
  const text = valueText(value).trim()
  if (!text) return null
  const parsed = Date.parse(text)
  if (Number.isFinite(parsed)) return parsed
  const numbers = [...text.matchAll(/\d+/gu)].map((match) => Number(match[0]))
  if (!numbers.length) return null
  if (numbers.length >= 3 && numbers[0] >= 1000 && numbers[1] >= 1 && numbers[1] <= 12 && numbers[2] >= 1 && numbers[2] <= 31) {
    return Date.UTC(numbers[0], numbers[1] - 1, numbers[2])
  }
  return Number.isFinite(numbers[0]) ? numbers[0] : null
}

function timelineDate(entity: EntityRecord) {
  const values = fieldValues(entity, ['date', 'startDate', 'time'])
  return values.map(parseChronology).find((value): value is number => value !== null) ?? null
}

function fieldDate(entity: EntityRecord, keys: string[]) {
  return fieldValues(entity, keys).map(parseChronology).find((value): value is number => value !== null) ?? null
}

function timelineRange(entity: EntityRecord) {
  const start = fieldDate(entity, ['startDate', 'startTime', 'beginDate'])
  const end = fieldDate(entity, ['endDate', 'endTime', 'finishDate'])
  return { start, end }
}

function timelineAgeValues(event: EntityRecord, character: EntityRecord) {
  const values: unknown[] = []
  for (const value of fieldValues(event, ['age', 'characterAge'])) {
    if (mentionsEntity(fieldValues(event, ['character', 'characterId', 'characters', 'participants']), character)) values.push(value)
  }
  for (const value of fieldValues(event, ['ages', 'ageAt', 'ageHistory', 'ageTimeline', 'ageByChapter', 'characterAges'])) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value)) {
        if (entityAliases(character).some((alias) => normalizedText(alias) === normalizedText(key))) values.push(nested)
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        if (mentionsEntity(record.character ?? record.characterId ?? record.name ?? record.person, character)) values.push(record.age ?? record.value)
      }
    }
  }
  return numericValues(values)
}

function characterAgeValues(character: EntityRecord, timelines: EntityRecord[]) {
  const own = numericValues(fieldValues(character, ['age', 'currentAge', 'ages', 'ageAt', 'ageAtChapter', 'ageHistory', 'ageTimeline', 'ageByChapter']))
  const fromTimeline = timelines.flatMap((event) => timelineAgeValues(event, character))
  return distinctNumbers([...own, ...fromTimeline])
}

function characterBirthdayValues(character: EntityRecord, timelines: EntityRecord[]) {
  const values = fieldValues(character, ['birthday', 'birthDate', 'dateOfBirth', 'birthDay', 'birthdays', 'birthdayHistory'])
    .flatMap((value) => nestedValues(value))
    .map(valueText)
    .map((value) => value.trim().replace(/[\s./年月日]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, ''))
    .filter(Boolean)
  const timelineValues = timelines
    .filter((event) => mentionsEntity(fieldValues(event, ['character', 'characterId', 'characters', 'participants']), character))
    .flatMap((event) => fieldValues(event, ['birthday', 'birthDate', 'dateOfBirth']))
    .flatMap((value) => nestedValues(value))
    .map(valueText)
    .map((value) => value.trim().replace(/[\s./年月日]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, ''))
    .filter(Boolean)
  return [...new Set([...values, ...timelineValues].map(normalizedText))]
}

function normalizedGender(value: unknown) {
  const text = normalizedText(valueText(value))
  if (!text) return ''
  if (['男', '男性', 'male', 'man', 'm'].includes(text)) return 'male'
  if (['女', '女性', 'female', 'woman', 'f'].includes(text)) return 'female'
  if (['非二元', '非二元性别', 'nonbinary', 'non-binary', 'other', '其他'].includes(text)) return 'other'
  return text
}

function characterGenderValues(character: EntityRecord) {
  return [...new Set(fieldValues(character, ['gender', 'sex', 'genderIdentity', 'genderHistory'])
    .flatMap((value) => nestedValues(value))
    .map(normalizedGender)
    .filter(Boolean))]
}

function isDeadStatus(value: unknown) {
  return ['死亡', '已死亡', 'dead', 'deceased'].includes(normalizedText(valueText(value)))
}

function isDeathEvent(event: EntityRecord) {
  return fieldValues(event, ['status', 'state', 'activity', 'eventType', 'type'])
    .flatMap((value) => nestedValues(value))
    .some((value) => isDeadStatus(value) || ['死亡', 'death', 'dead'].includes(normalizedText(valueText(value))))
}

function isSimilarName(left: string, right: string) {
  const a = left.trim().replace(/[\s·。、“”"'’‘\-—_]+/gu, '').toLocaleLowerCase()
  const b = right.trim().replace(/[\s·。、“”"'’‘\-—_]+/gu, '').toLocaleLowerCase()
  if (a.length < 2 || b.length < 2 || a === b || Math.abs(a.length - b.length) > 1) return false
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0]
    previous[0] = row
    for (let column = 1; column <= b.length; column += 1) {
      const next = previous[column]
      previous[column] = a[row - 1] === b[column - 1]
        ? diagonal
        : Math.min(diagonal + 1, previous[column] + 1, previous[column - 1] + 1)
      diagonal = next
    }
  }
  return previous[b.length] <= 1
}

function issue(
  severity: ConsistencyIssue['severity'], code: string, title: string, detail: string,
  refId: string, refKind: string, path: string,
): ConsistencyIssue {
  return { id: `${code}:${refId}:${title}`, severity, code, title, detail, refId, refKind, path }
}

function chapterReferenceExists(nodes: NodeRecord[], value: string) {
  return Boolean(findChapterByReference(nodes, value))
}

export function analyzeConsistency(data: ProjectData, documents: Record<string, string>): ConsistencyReport {
  const issues: ConsistencyIssue[] = []
  const activeEntities = data.entities
  issues.push(...storyArcHealthIssues(data))
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
        if (!chapterReferenceExists(data.nodes, reference)) {
          issues.push(issue('warning', 'missing-chapter-reference', `${field.label}不存在`, `“${reference}”无法匹配当前正文中的章节。`, entity.id, entity.kind, entity.filePath))
        }
      }
    }
    if (entity.kind === 'foreshadowing') {
      const status = normalizeForeshadowingStatus(entityValue(entity, 'status'))
      const actualPayoff = entityValue(entity, 'actualPayoff').trim()
      if (actualPayoff && status !== 'paid-off') {
        issues.push(issue('warning', 'foreshadowing-status', '伏笔状态未标记为已回收', '已经填写实际回收章节，但当前状态仍未标记为“已回收”。', entity.id, entity.kind, entity.filePath))
      }
    }
  }

  const characters = activeEntities.filter((entity) => entity.kind === 'character')
  const timelines = activeEntities.filter((entity) => entity.kind === 'timeline')
  for (const character of characters) {
    const ages = characterAgeValues(character, timelines)
    if (ages.length > 1 && Math.max(...ages) - Math.min(...ages) >= 2) {
      issues.push(issue('warning', 'character-age-conflict', '可能存在年龄冲突', '人物“' + character.title + '”的结构化年龄记录为 ' + ages.join('、') + '，差异较大，请确认时间线或年龄设定。', character.id, character.kind, character.filePath))
    }
    const birthdays = characterBirthdayValues(character, timelines)
    if (birthdays.length > 1) {
      issues.push(issue('warning', 'character-birthday-conflict', '生日描述可能冲突', '人物“' + character.title + '”存在多个结构化生日记录：' + birthdays.join('、') + '。', character.id, character.kind, character.filePath))
    }
    const genders = characterGenderValues(character)
    if (genders.length > 1) {
      issues.push(issue('warning', 'character-gender-conflict', '性别描述可能冲突', '人物“' + character.title + '”的结构化性别字段出现不一致值：' + genders.join('、') + '。', character.id, character.kind, character.filePath))
    }

    const dead = fieldValues(character, ['status', 'state', 'lifeStatus']).flatMap((value) => nestedValues(value)).some(isDeadStatus)
    let deathAt = fieldDate(character, ['deathDate', 'dateOfDeath', 'deceasedAt', 'deathTime'])
    if (deathAt === null) {
      for (const event of timelines) {
        if (!mentionsEntity(fieldValues(event, ['character', 'characterId', 'characters', 'participants']), character) || !isDeathEvent(event)) continue
        const date = timelineDate(event)
        if (date !== null && (deathAt === null || date < deathAt)) deathAt = date
      }
    }
    if (dead && deathAt !== null) {
      const laterAppearance = timelines.find((event) => {
        const date = timelineDate(event)
        return date !== null && date > deathAt! && mentionsEntity(fieldValues(event, ['character', 'characterId', 'characters', 'participants']), character) && !isDeathEvent(event)
      })
      if (laterAppearance) {
        issues.push(issue('warning', 'posthumous-appearance', '人物可能在死亡事件之后继续出现', '人物“' + character.title + '”在结构化死亡时间之后仍出现在时间线事件“' + laterAppearance.title + '”中，请确认是否为回忆、幻象或时间线误记。', character.id, character.kind, character.filePath))
      }
    }
  }

  const characterGroups = new Map<string, EntityRecord[]>()
  for (const character of characters) {
    const key = normalizedText(character.title)
    const group = characterGroups.get(key) ?? []
    group.push(character)
    characterGroups.set(key, group)
  }
  for (const group of characterGroups.values()) {
    if (group.length < 2) continue
    const genders = [...new Set(group.flatMap(characterGenderValues))]
    if (genders.length > 1) {
      issues.push(issue('warning', 'character-gender-conflict', '性别描述可能冲突', '同名人物资料的结构化性别字段出现不一致值：' + genders.join('、') + '。', group[0].id, group[0].kind, group[0].filePath))
    }
  }

  for (let left = 0; left < characters.length; left += 1) {
    for (let right = left + 1; right < characters.length; right += 1) {
      if (!isSimilarName(characters[left].title, characters[right].title)) continue
      issues.push(issue('warning', 'similar-character-name', '名称可能相似', '人物“' + characters[left].title + '”与“' + characters[right].title + '”名称相似，请确认是否为不同人物或同一人物的拼写变化。', characters[right].id, characters[right].kind, characters[right].filePath))
    }
  }

  const locations = activeEntities.filter((entity) => entity.kind === 'location')
  for (let left = 0; left < locations.length; left += 1) {
    for (let right = left + 1; right < locations.length; right += 1) {
      if (!isSimilarName(locations[left].title, locations[right].title)) continue
      issues.push(issue('warning', 'similar-location-name', '地点名称可能相似', '地点“' + locations[left].title + '”与“' + locations[right].title + '”名称相似，请确认层级或拼写。', locations[right].id, locations[right].kind, locations[right].filePath))
    }
  }

  let previousTimeline: { entity: EntityRecord; date: number } | null = null
  for (const event of timelines) {
    const range = timelineRange(event)
    if (range.start !== null && range.end !== null && range.end < range.start) {
      issues.push(issue('warning', 'timeline-range', '时间线结束时间早于开始时间', '事件“' + event.title + '”的结束时间早于开始时间，请确认时间范围。', event.id, event.kind, event.filePath))
    }
    const date = timelineDate(event)
    if (date === null) continue
    if (previousTimeline && date < previousTimeline.date) {
      issues.push(issue('warning', 'timeline-order', '时间线日期可能逆序', '事件“' + event.title + '”的日期早于前一个结构化事件“' + previousTimeline.entity.title + '”，请确认时间线顺序。', event.id, event.kind, event.filePath))
    }
    previousTimeline = { entity: event, date }
  }

  const errors = issues.filter((item) => item.severity === 'error').length
  const warnings = issues.filter((item) => item.severity === 'warning').length
  return { checkedAt: new Date().toISOString(), issueCount: issues.length, errors, warnings, issues }
}
