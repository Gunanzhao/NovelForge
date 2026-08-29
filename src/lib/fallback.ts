import type {
  EntityInput, EntityRecord, ExportInput, HistoryItem, NodeRecord, ProjectData,
  ProjectInput, SearchInput, SearchResult, TrashItem,
} from './types'
import { analyzeConsistency } from './consistency-data'
import { countWords } from './utils'

interface StoredHistory extends HistoryItem {
  content: string
}

interface TrashSnapshot {
  nodes: NodeRecord[]
  documents: Record<string, string>
  entities: EntityRecord[]
}

interface FallbackStore {
  data: ProjectData
  documents: Record<string, string>
  history: StoredHistory[]
  trash: TrashItem[]
  trashSnapshots: Record<string, TrashSnapshot>
  activities: Array<{ createdAt: string; deltaWords: number }>
}

const memory = new Map<string, FallbackStore>()
const STORAGE_PREFIX = 'novelforge-fallback:'
const NODE_STATUSES = new Set(['not-started', 'draft', 'first-draft', 'editing', 'done', 'locked'])
const ENTITY_KINDS = new Set(['character', 'location', 'world', 'timeline', 'foreshadowing', 'outline', 'scene', 'note', 'relationship', 'attachment'])

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? ('fallback-' + Date.now() + '-' + Math.random().toString(16).slice(2))
}

function storageKey(path: string) {
  return STORAGE_PREFIX + encodeURIComponent(path || 'default')
}

function persist(path: string, store: FallbackStore) {
  memory.set(storageKey(path), store)
  try {
    localStorage.setItem(storageKey(path), JSON.stringify(store))
  } catch {
    // 浏览器隐私模式可能禁用 localStorage，内存 fallback 仍可使用。
  }
}

function readStore(path: string) {
  const key = storageKey(path)
  const cached = memory.get(key)
  if (cached) return cached
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as FallbackStore
      parsed.history ??= []
      parsed.trash ??= []
      parsed.trashSnapshots ??= {}
      parsed.activities ??= []
      memory.set(key, parsed)
      return parsed
    }
  } catch {
    // 损坏的浏览器 fallback 不会影响桌面项目。
  }
  return undefined
}

function makeProject(input: ProjectInput): FallbackStore {
  const createdAt = new Date().toISOString()
  const projectId = uid()
  const volumeId = uid()
  const chapterId = uid()
  const chapter: NodeRecord = {
    id: chapterId, kind: 'chapter', parentId: volumeId, title: '第一章', orderIndex: 0,
    status: 'draft', filePath: 'manuscript/volume_001/chapter_001.md', createdAt, updatedAt: createdAt,
  }
  const content = '# 第一章\n\n从这里开始你的故事。\n'
  return {
    data: {
      project: {
        formatVersion: 1, id: projectId, title: input.title.trim(), author: input.author.trim(),
        description: input.description.trim(), genre: input.genre.trim(), targetWords: input.targetWords,
        createdAt, updatedAt: createdAt,
      },
      nodes: [{
        id: volumeId, kind: 'volume', parentId: null, title: '第一卷', orderIndex: 0,
        status: 'not-started', filePath: 'manuscript/volume_001', createdAt, updatedAt: createdAt,
      }, chapter],
      entities: [],
      recovery: [],
    },
    documents: { [chapterId]: content },
    history: [],
    trash: [],
    trashSnapshots: {},
    activities: [],
  }
}

function updateTime(data: ProjectData) {
  data.project.updatedAt = new Date().toISOString()
}

function node(store: FallbackStore, id: string) {
  return store.data.nodes.find((item) => item.id === id)
}

function entity(store: FallbackStore, id: string) {
  return store.data.entities.find((item) => item.id === id)
}

function nodeDescendants(store: FallbackStore, rootId: string) {
  const result: NodeRecord[] = []
  const queue = [rootId]
  while (queue.length) {
    const currentId = queue.shift()
    if (!currentId) continue
    const current = node(store, currentId)
    if (!current) continue
    result.push(current)
    queue.push(...store.data.nodes.filter((item) => item.parentId === currentId).map((item) => item.id))
  }
  return result
}

function validateNodeTarget(store: FallbackStore, kind: NodeRecord['kind'], targetParentId: string | null) {
  const parent = targetParentId ? node(store, targetParentId) : undefined
  if (kind === 'volume' && parent) throw new Error('卷不能移动到其他节点下面')
  if (kind === 'chapter' && parent?.kind !== 'volume') throw new Error('章节只能放在卷下面')
  if (kind === 'section' && parent?.kind !== 'chapter') throw new Error('小节只能放在章节下面')
  return parent
}

function fallbackNodePath(store: FallbackStore, kind: NodeRecord['kind'], parent: NodeRecord | undefined, order: number) {
  const prefix = kind === 'volume'
    ? 'manuscript/volume_'
    : kind === 'chapter'
      ? (parent?.filePath ?? 'manuscript') + '/chapter_'
      : (parent?.filePath ?? 'manuscript/chapter').replace(/\.md$/u, '') + '/section_'
  let index = order + 1
  let candidate = kind === 'volume' ? prefix + String(index).padStart(3, '0') : prefix + String(index).padStart(3, '0') + '.md'
  while (store.data.nodes.some((item) => item.filePath === candidate)) {
    index += 1
    candidate = kind === 'volume' ? prefix + String(index).padStart(3, '0') : prefix + String(index).padStart(3, '0') + '.md'
  }
  return candidate
}

function replaceNodePath(path: string, oldPrefix: string, newPrefix: string) {
  if (path === oldPrefix) return newPrefix
  const boundary = oldPrefix.replace(/\/$/u, '') + '/'
  return path.startsWith(boundary) ? newPrefix.replace(/\/$/u, '') + '/' + path.slice(boundary.length) : path
}

function replaceMarkdownTitle(content: string, title: string) {
  if (content.startsWith('# ')) {
    const end = content.indexOf('\n')
    return '# ' + title + (end < 0 ? '\n' : content.slice(end))
  }
  return '# ' + title + '\n\n' + content
}

function nodeVolumeOrder(store: FallbackStore, current: NodeRecord) {
  if (current.kind === 'volume') return current.orderIndex
  let parentId = current.parentId
  while (parentId) {
    const parent = node(store, parentId)
    if (!parent) return Number.MAX_SAFE_INTEGER
    if (parent.kind === 'volume') return parent.orderIndex
    parentId = parent.parentId
  }
  return Number.MAX_SAFE_INTEGER
}

export function exportText(store: FallbackStore, format: 'markdown' | 'txt' | 'html', input: ExportInput) {
  const title = input.title?.trim() || store.data.project.title
  const author = input.author?.trim() || store.data.project.author
  const includeVolumeTitles = input.includeVolumeTitles !== false
  const includeChapterTitles = input.includeChapterTitles !== false
  const selectedIds = new Set<string>()
  if (input.scope === 'volume' && !input.volumePath) throw new Error('指定卷导出需要卷路径')
  if (input.scope === 'chapters') {
    if (!input.nodeIds?.length) throw new Error('指定章节导出需要章节 ID')
    for (const id of input.nodeIds) {
      const descendants = nodeDescendants(store, id)
      if (!descendants.length) throw new Error('指定章节不存在：' + id)
      descendants.forEach((item) => selectedIds.add(item.id))
    }
  }
  const active = store.data.nodes.filter((item) => {
    if (input.scope === 'volume') return item.filePath === input.volumePath || Boolean(input.volumePath && item.filePath.startsWith(input.volumePath + '/'))
    if (input.scope === 'chapters') return selectedIds.has(item.id)
    return true
  })
  const roots = active
    .filter((item) => !active.some((candidate) => candidate.id === item.parentId))
    .sort((left, right) => nodeVolumeOrder(store, left) - nodeVolumeOrder(store, right) || left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
  const renderNode = (current: NodeRecord, level: number): string => {
    const includeTitle = current.kind === 'volume' ? includeVolumeTitles : includeChapterTitles
    const heading = includeTitle
      ? format === 'markdown' ? '\n' + '#'.repeat(Math.max(1, level)) + ' ' + current.title + '\n' : '\n' + current.title + '\n'
      : ''
    const body = current.kind === 'volume' ? '' : '\n' + (store.documents[current.id] ?? '').replace(/^# .*\n?/u, '').trim() + '\n'
    const children = active.filter((item) => item.parentId === current.id).sort((a, b) => a.orderIndex - b.orderIndex).map((item) => renderNode(item, level + 1)).join('')
    return heading + body + children
  }
  const rendered = roots.map((root) => renderNode(root, 1)).join('')
  const toc = input.includeToc === false ? '' : format === 'markdown'
    ? '\n## 目录\n\n' + active.filter((item) => item.kind !== 'section').map((item) => '- ' + item.title).join('\n') + '\n\n'
    : ''
  const markdown = '# ' + title + '\n\n作者：' + author + '\n\n' + toc + rendered
  if (format === 'html') {
    const htmlBody = markdown.split('\n').filter(Boolean).map((line) => {
      const heading = /^(#{1,6}) (.+)$/u.exec(line)
      return heading ? '<h' + heading[1].length + '>' + heading[2] + '</h' + heading[1].length + '>' : '<p>' + line + '</p>'
    }).join('')
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + title + '</title></head><body><h1>' + title + '</h1><p>作者：' + author + '</p>' + htmlBody + '</body></html>'
  }
  return format === 'markdown' ? markdown : title + '\n作者：' + author + '\n\n' + rendered
}

function restoreTrashSnapshot(store: FallbackStore, trash: TrashItem) {
  const snapshot = store.trashSnapshots[trash.id]
  if (!snapshot) throw new Error('此回收站条目没有可恢复的快照')
  const activeNodeIds = new Set(store.data.nodes.map((item) => item.id))
  const activeNodePaths = new Set(store.data.nodes.map((item) => item.filePath))
  const activeEntityIds = new Set(store.data.entities.map((item) => item.id))
  const activeEntityPaths = new Set(store.data.entities.map((item) => item.filePath))
  if (snapshot.nodes.some((item) => activeNodeIds.has(item.id) || activeNodePaths.has(item.filePath))) {
    throw new Error('恢复失败：正文节点或文件路径已经被占用')
  }
  if (snapshot.entities.some((item) => activeEntityIds.has(item.id) || activeEntityPaths.has(item.filePath))) {
    throw new Error('恢复失败：资料条目或文件路径已经被占用')
  }
  const snapshotNodeIds = new Set(snapshot.nodes.map((item) => item.id))
  const availableParentIds = new Set([...activeNodeIds, ...snapshotNodeIds])
  if (snapshot.nodes.some((item) => item.parentId && !availableParentIds.has(item.parentId))) {
    throw new Error('恢复失败：父级节点不存在')
  }
  const restoredNodes = snapshot.nodes.map((item) => ({ ...item }))
  for (const item of restoredNodes) {
    if (item.parentId && !snapshotNodeIds.has(item.parentId)) {
      const siblingCount = store.data.nodes.filter((candidate) => candidate.parentId === item.parentId && candidate.kind === item.kind).length
      item.orderIndex = siblingCount
    }
  }
  store.data.nodes.push(...restoredNodes)
  store.data.entities.push(...snapshot.entities.map((item) => ({ ...item, tags: [...item.tags], content: { ...item.content } })))
  Object.assign(store.documents, snapshot.documents)
  store.trash = store.trash.filter((item) => item.id !== trash.id)
  delete store.trashSnapshots[trash.id]
  updateTime(store.data)
}

export async function fallbackInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (command === 'create_project') {
    const input = args.input as ProjectInput
    if (typeof input?.path !== 'string' || !input.path.trim()) throw new Error('项目路径不能为空')
    if (typeof input?.title !== 'string' || !input.title.trim()) throw new Error('作品名不能为空')
    if (!Number.isSafeInteger(input?.targetWords) || input.targetWords < 0) throw new Error('目标字数无效')
    if (readStore(input.path)) throw new Error('该浏览器项目已经存在')
    const store = makeProject(input)
    persist(input.path, store)
    return store.data as T
  }
  const path = (args.path ?? ((args.input as { projectPath?: string } | undefined)?.projectPath ?? '')) as string
  const input = args.input as Record<string, unknown> | undefined
  const projectPath = (input?.projectPath as string | undefined) ?? path
  const store = readStore(projectPath)
  if (!store) throw new Error('浏览器开发模式中没有找到该项目，请先创建项目。')

  if (command === 'open_project') return store.data as T
  if (command === 'list_documents') return store.data.nodes as T
  if (command === 'get_document') {
    const id = input?.nodeId as string
    const current = node(store, id)
    if (!current) throw new Error('章节不存在')
    if (current.kind === 'volume') throw new Error('卷没有正文文件')
    return { node: current, content: store.documents[id] ?? '' } as T
  }
  if (command === 'create_node') {
    const kind = input?.kind as NodeRecord['kind']
    const parentId = (input?.parentId as string | null) ?? null
    const title = (input?.title as string | undefined)?.trim() ?? ''
    if (!['volume', 'chapter', 'section'].includes(kind)) throw new Error('不支持的正文节点类型')
    if (!title) throw new Error('节点标题不能为空')
    const parent = validateNodeTarget(store, kind, parentId)
    const siblings = store.data.nodes.filter((item) => item.parentId === parentId && item.kind === kind)
    const orderIndex = siblings.length
    const createdAt = new Date().toISOString()
    const id = uid()
    const filePath = fallbackNodePath(store, kind, parent, orderIndex)
    const newNode: NodeRecord = {
      id, kind, parentId, title, orderIndex, status: 'not-started', filePath, createdAt, updatedAt: createdAt,
    }
    store.data.nodes.push(newNode)
    if (kind !== 'volume') store.documents[id] = '# ' + title + '\n\n'
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'rename_node') {
    const current = node(store, input?.nodeId as string)
    if (!current) throw new Error('节点不存在')
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    if (!title) throw new Error('名称不能为空')
    current.title = title
    if (current.kind !== 'volume') store.documents[current.id] = replaceMarkdownTitle(store.documents[current.id] ?? '', title)
    current.updatedAt = new Date().toISOString()
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'set_node_status') {
    const current = node(store, input?.nodeId as string)
    if (!current) throw new Error('节点不存在')
    const status = input?.status as string
    if (!NODE_STATUSES.has(status)) throw new Error('状态无效')
    current.status = status
    current.updatedAt = new Date().toISOString()
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'reorder_node') {
    const current = node(store, input?.nodeId as string)
    if (!current) throw new Error('节点不存在')
    if (input?.direction !== 'up' && input?.direction !== 'down') throw new Error('排序方向无效')
    const direction = input.direction === 'up' ? -1 : 1
    const other = store.data.nodes.find((item) => item.parentId === current.parentId && item.orderIndex === current.orderIndex + direction)
    if (other) {
      other.orderIndex = current.orderIndex
      current.orderIndex += direction
    }
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'move_node') {
    const id = input?.nodeId as string
    const current = node(store, id)
    if (!current) throw new Error('节点不存在')
    const targetParentId = (input?.targetParentId as string | null) ?? null
    const targetParent = validateNodeTarget(store, current.kind, targetParentId)
    const descendants = nodeDescendants(store, id)
    if (targetParentId && descendants.some((item) => item.id === targetParentId)) throw new Error('不能将节点移动到自己的后代下面')
    const siblings = store.data.nodes.filter((item) => item.parentId === targetParentId && item.id !== id)
    if (input?.targetOrderIndex !== undefined && !Number.isSafeInteger(input.targetOrderIndex)) throw new Error('目标顺序无效')
    const requested = typeof input?.targetOrderIndex === 'number' ? input.targetOrderIndex : siblings.length
    const targetOrder = Math.max(0, Math.min(requested, siblings.length))
    const oldParentId = current.parentId
    const oldOrder = current.orderIndex
    const oldPath = current.filePath
    for (const sibling of store.data.nodes.filter((item) => item.parentId === oldParentId && item.id !== id && item.orderIndex > oldOrder)) sibling.orderIndex -= 1
    for (const sibling of store.data.nodes.filter((item) => item.parentId === targetParentId && item.id !== id && item.orderIndex >= targetOrder)) sibling.orderIndex += 1
    const newPath = oldParentId === targetParentId ? oldPath : fallbackNodePath(store, current.kind, targetParent, targetOrder)
    current.parentId = targetParentId
    current.orderIndex = targetOrder
    current.filePath = newPath
    current.updatedAt = new Date().toISOString()
    for (const child of descendants.filter((item) => item.id !== id)) child.filePath = replaceNodePath(child.filePath, oldPath, newPath)
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'copy_node') {
    const id = input?.nodeId as string
    const current = node(store, id)
    if (!current) throw new Error('节点不存在')
    const targetParentId = (input?.targetParentId as string | null) ?? null
    const targetParent = validateNodeTarget(store, current.kind, targetParentId)
    const descendants = nodeDescendants(store, id)
    if (targetParentId && descendants.some((item) => item.id === targetParentId)) throw new Error('不能将节点复制到自己的后代下面')
    const siblings = store.data.nodes.filter((item) => item.parentId === targetParentId)
    const targetOrder = siblings.length
    const targetPath = fallbackNodePath(store, current.kind, targetParent, targetOrder)
    const idMap = new Map(descendants.map((item) => [item.id, uid()]))
    for (const sibling of siblings) sibling.orderIndex += 1
    for (const source of descendants) {
      const copyId = idMap.get(source.id)
      if (!copyId) continue
      const copy: NodeRecord = {
        ...source,
        id: copyId,
        parentId: source.id === current.id ? targetParentId : idMap.get(source.parentId ?? '') ?? null,
        title: source.id === current.id ? (typeof input?.title === 'string' ? input.title.trim() : '') || source.title + ' 副本' : source.title,
        orderIndex: source.id === current.id ? targetOrder : source.orderIndex,
        filePath: replaceNodePath(source.filePath, current.filePath, targetPath),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      store.data.nodes.push(copy)
      if (source.kind !== 'volume') store.documents[copy.id] = store.documents[source.id] ?? ''
    }
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'save_document') {
    const id = input?.nodeId as string
    const current = node(store, id)
    if (!current) throw new Error('章节不存在')
    if (current.kind === 'volume') throw new Error('只有未删除的章节或小节可以编辑')
    if (typeof input?.content !== 'string') throw new Error('正文内容无效')
    const content = input.content
    const old = store.documents[id] ?? ''
    const now = new Date().toISOString()
    const revision: StoredHistory = {
      id: uid(), nodeId: id, nodeTitle: current.title, reason: (input?.reason as string) || '自动保存',
      wordCount: countWords(content), createdAt: now, path: 'fallback://history/' + id, content,
    }
    store.history.unshift(revision)
    store.documents[id] = content
    store.activities.push({ createdAt: now, deltaWords: countWords(content) - countWords(old) })
    current.updatedAt = now
    updateTime(store.data)
    persist(projectPath, store)
    return { node: current, content } as T
  }
  if (command === 'list_history') return store.history.filter((item) => item.nodeId === input?.nodeId).map((item) => ({ id: item.id, nodeId: item.nodeId, nodeTitle: item.nodeTitle, reason: item.reason, wordCount: item.wordCount, createdAt: item.createdAt, path: item.path })) as T
  if (command === 'read_history') {
    const item = store.history.find((history) => history.id === input?.revisionId)
    if (!item) throw new Error('版本不存在')
    return item.content as T
  }
  if (command === 'restore_history') {
    const item = store.history.find((history) => history.id === input?.revisionId)
    if (!item) throw new Error('版本不存在')
    const current = node(store, item.nodeId)
    if (!current) throw new Error('章节不存在')
    if (current.kind === 'volume') throw new Error('只有未删除的章节或小节可以编辑')
    const oldContent = store.documents[item.nodeId] ?? ''
    const now = new Date().toISOString()
    store.history.unshift({
      id: uid(), nodeId: item.nodeId, nodeTitle: current.title, reason: '恢复前自动快照',
      wordCount: countWords(oldContent), createdAt: now, path: 'fallback://history/' + item.nodeId, content: oldContent,
    })
    store.documents[item.nodeId] = item.content
    store.activities.push({ createdAt: now, deltaWords: countWords(item.content) - countWords(oldContent) })
    current.updatedAt = now
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'list_recovery') return store.data.recovery as T
  if (command === 'read_recovery') throw new Error('浏览器 fallback 没有未完成恢复文件')
  if (command === 'restore_recovery' || command === 'discard_recovery') return store.data as T
  if (command === 'upsert_entity') {
    const entityInput = input as unknown as EntityInput
    const title = typeof entityInput.title === 'string' ? entityInput.title.trim() : ''
    if (!title) throw new Error('条目名称不能为空')
    if (!ENTITY_KINDS.has(entityInput.kind)) throw new Error('资料类型无效')
    if (!Array.isArray(entityInput.tags) || entityInput.tags.some((tag) => typeof tag !== 'string')) throw new Error('标签格式无效')
    const existing = entityInput.id ? entity(store, entityInput.id) : undefined
    if (!existing && entityInput.id && Object.values(store.trashSnapshots).some((snapshot) => snapshot.entities.some((item) => item.id === entityInput.id))) {
      throw new Error('回收站中的资料不能直接编辑，请先恢复')
    }
    if (existing && existing.kind !== entityInput.kind) throw new Error('资料类型不能在编辑时修改')
    const current: EntityRecord = existing ?? {
      id: entityInput.id ?? uid(), kind: entityInput.kind, title,
      content: {}, tags: [], filePath: entityInput.kind + '/' + uid() + '.md',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    current.kind = entityInput.kind
    current.title = title
    current.content = entityInput.content
    current.tags = entityInput.tags
    current.updatedAt = new Date().toISOString()
    if (!existing) store.data.entities.push(current)
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'list_entities') {
    const kind = (args.kind ?? input?.kind) as string | undefined
    return store.data.entities.filter((item) => !kind || item.kind === kind) as T
  }
  if (command === 'delete_entity') {
    const current = entity(store, input?.nodeId as string)
    if (!current) throw new Error('资料条目不存在')
    const trashId = uid()
    store.data.entities = store.data.entities.filter((item) => item.id !== current.id)
    store.trash.push({ id: trashId, refId: current.id, refKind: 'entity', title: current.title, originalPath: current.filePath, trashPath: 'fallback://trash', deletedAt: new Date().toISOString() })
    store.trashSnapshots[trashId] = { nodes: [], documents: {}, entities: [current] }
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'delete_node') {
    const id = input?.nodeId as string
    const current = node(store, id)
    if (!current) throw new Error('节点不存在')
    const descendants = nodeDescendants(store, id)
    const descendantIds = new Set(descendants.map((item) => item.id))
    const trashId = uid()
    const documents = Object.fromEntries(descendants.filter((item) => item.kind !== 'volume').map((item) => [item.id, store.documents[item.id] ?? '']))
    store.data.nodes = store.data.nodes.filter((item) => !descendantIds.has(item.id))
    for (const descendant of descendants) delete store.documents[descendant.id]
    store.trash.push({ id: trashId, refId: id, refKind: 'node', title: current.title, originalPath: current.filePath, trashPath: 'fallback://trash', deletedAt: new Date().toISOString() })
    store.trashSnapshots[trashId] = { nodes: descendants, documents, entities: [] }
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'list_trash') return store.trash as T
  if (command === 'empty_trash') {
    store.trash = []
    store.trashSnapshots = {}
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'restore_trash') {
    const trash = store.trash.find((item) => item.id === input?.nodeId)
    if (!trash) throw new Error('回收站项目不存在')
    restoreTrashSnapshot(store, trash)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'permanent_delete') {
    if (!store.trash.some((item) => item.id === input?.nodeId)) throw new Error('回收站项目不存在')
    store.trash = store.trash.filter((item) => item.id !== input?.nodeId)
    delete store.trashSnapshots[input?.nodeId as string]
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'search_project') {
    const search = args.input as SearchInput
    const query = search.query.trim()
    const normalizedQuery = query.toLocaleLowerCase()
    const volumeMatches = (path: string) => !search.volumePath || path.startsWith(search.volumePath.replace(/\\/gu, '/') + '/')
    const textMatches = (title: string, content: string) => {
      const source = title + content
      return search.caseSensitive ? source.includes(query) : source.toLocaleLowerCase().includes(normalizedQuery)
    }
    const tagMatches = (item: EntityRecord) => !search.tag || item.tags.some((tag) => search.caseSensitive ? tag.includes(search.tag ?? '') : tag.toLocaleLowerCase().includes((search.tag ?? '').toLocaleLowerCase()))
    const results: SearchResult[] = []
    for (const item of store.data.nodes.filter((candidate) => candidate.kind !== 'volume')) {
      const content = store.documents[item.id] ?? ''
      const currentOnly = search.scope === 'current' && search.nodeId !== item.id
      if (!currentOnly && (!search.kind || search.kind === 'manuscript') && volumeMatches(item.filePath) && textMatches(item.title, content)) {
        results.push({ id: item.id, kind: item.kind, title: item.title, path: item.filePath, snippet: content.slice(0, 160) })
      }
    }
    for (const item of store.data.entities) {
      const content = JSON.stringify(item.content)
      const currentOnly = search.scope === 'current'
      if (!currentOnly && (!search.kind || search.kind === item.kind) && tagMatches(item) && textMatches(item.title, content)) {
        results.push({ id: item.id, kind: item.kind, title: item.title, path: item.filePath, snippet: content.slice(0, 160) })
      }
    }
    return results.slice(0, 100) as T
  }
  if (command === 'check_consistency') return analyzeConsistency(store.data, store.documents) as T
  if (command === 'open_attachment') {
    const current = entity(store, input?.nodeId as string)
    if (!current || current.kind !== 'attachment') throw new Error('附件不存在')
    return ('fallback://' + current.filePath) as T
  }
  if (command === 'ai_complete') {
    const aiInput = args.input as { model?: string; prompt: string }
    const excerpt = aiInput.prompt.trim().slice(0, 900)
    return { model: 'novelforge-local', content: `【本地辅助草稿】\n\n当前浏览器开发模式没有连接远程 Provider。以下内容根据已选上下文生成了可继续编辑的提示草稿：\n\n${excerpt}\n\n请在上方补充你的写作意图，再将这份草稿改写成正文。` } as T
  }
  if (command === 'get_statistics') {
    let total = 0
    for (const content of Object.values(store.documents)) total += countWords(content)
    const now = new Date()
    const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const today = dayKey(now)
    const offsetKey = (offset: number) => {
      const date = new Date(now)
      date.setDate(now.getDate() - offset)
      return dayKey(date)
    }
    const dailyTotals = new Map<string, number>()
    for (const item of store.activities) {
      const key = dayKey(new Date(item.createdAt))
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + Math.max(0, item.deltaWords))
    }
    const todayWords = dailyTotals.get(today) ?? 0
    const yesterdayWords = dailyTotals.get(offsetKey(1)) ?? 0
    const sumSince = (days: number) => Array.from({ length: days }, (_, offset) => dailyTotals.get(offsetKey(offset)) ?? 0).reduce((sum, words) => sum + words, 0)
    const daily = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(now)
      date.setDate(now.getDate() - (29 - index))
      const key = dayKey(date)
      return { date: key, words: dailyTotals.get(key) ?? 0 }
    })
    const chapterStats = store.data.nodes.filter((item) => item.kind === 'chapter').map((item) => ({
      id: item.id, title: item.title, words: countWords(store.documents[item.id] ?? ''), updatedAt: item.updatedAt,
    })).sort((left, right) => right.words - left.words || left.title.localeCompare(right.title, 'zh-CN'))
    const activeDates = Array.from(dailyTotals.entries()).filter(([, words]) => words > 0).map(([date]) => date).sort()
    const averageDailyWords = activeDates.length ? Math.floor(Array.from(dailyTotals.values()).reduce((sum, words) => sum + words, 0) / activeDates.length) : 0
    let writingStreak = 0
    const cursor = new Date(now)
    while (dailyTotals.get(dayKey(cursor)) && (dailyTotals.get(dayKey(cursor)) ?? 0) > 0) {
      writingStreak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    let longestWritingStreak = 0
    let run = 0
    let previousDate = ''
    for (const date of activeDates) {
      const currentDate = new Date(date + 'T00:00:00')
      const previous = previousDate ? new Date(previousDate + 'T00:00:00') : undefined
      if (previous && Math.round((currentDate.getTime() - previous.getTime()) / 86400000) === 1) run += 1
      else run = 1
      longestWritingStreak = Math.max(longestWritingStreak, run)
      previousDate = date
    }
    const currentNodeId = (args.input as { currentNodeId?: string } | undefined)?.currentNodeId
    const currentNode = currentNodeId ? node(store, currentNodeId) : undefined
    const currentChapterWords = currentNode?.kind === 'chapter' ? countWords(store.documents[currentNode.id] ?? '') : 0
    let currentVolumeId: string | undefined
    let parentId = currentNode?.parentId
    while (parentId) {
      const parent = node(store, parentId)
      if (!parent) break
      if (parent.kind === 'volume') { currentVolumeId = parent.id; break }
      parentId = parent.parentId
    }
    const currentVolumeWords = currentVolumeId ? store.data.nodes.filter((item) => {
      if (item.kind === 'volume') return false
      let candidate = item.parentId
      while (candidate) {
        if (candidate === currentVolumeId) return true
        candidate = node(store, candidate)?.parentId ?? null
      }
      return false
    }).reduce((sum, item) => sum + countWords(store.documents[item.id] ?? ''), 0) : 0
    return {
      totalWords: total, currentVolumeWords, currentChapterWords, todayWords, yesterdayWords, weekWords: sumSince(7), monthWords: sumSince(30),
      chapterCount: store.data.nodes.filter((item) => item.kind === 'chapter').length,
      targetWords: store.data.project.targetWords, writingStreak, averageDailyWords, longestWritingStreak, daily, chapterStats,
    } as T
  }
  if (command === 'export_project') {
    const exportInput = args.input as ExportInput
    if (exportInput.format !== 'markdown' && exportInput.format !== 'txt' && exportInput.format !== 'html') {
      throw new Error('浏览器开发模式暂不生成 DOCX、EPUB 或 PDF，请使用桌面版导出。')
    }
    void exportText(store, exportInput.format, exportInput)
    return ('browser://exports/' + store.data.project.title + '.' + exportInput.format) as T
  }
  if (command === 'read_logs') return '' as T
  if (command === 'update_project') {
    const update = input as unknown as ProjectInput
    const title = typeof update?.title === 'string' ? update.title.trim() : ''
    if (!title) throw new Error('作品名不能为空')
    if (!Number.isSafeInteger(update?.targetWords) || update.targetWords < 0) throw new Error('目标字数无效')
    store.data.project.title = title
    store.data.project.author = typeof update.author === 'string' ? update.author.trim() : ''
    store.data.project.description = typeof update.description === 'string' ? update.description.trim() : ''
    store.data.project.genre = typeof update.genre === 'string' ? update.genre.trim() : ''
    store.data.project.targetWords = update.targetWords
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  throw new Error('开发模式暂不支持命令：' + command)
}
