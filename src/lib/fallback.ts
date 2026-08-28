import type {
  EntityInput, EntityRecord, ExportInput, HistoryItem, NodeRecord, ProjectData,
  ProjectInput, SearchInput, SearchResult, TrashItem,
} from './types'
import { countWords } from './utils'

interface StoredHistory extends HistoryItem {
  content: string
}

interface FallbackStore {
  data: ProjectData
  documents: Record<string, string>
  history: StoredHistory[]
  trash: TrashItem[]
  activities: Array<{ createdAt: string; deltaWords: number }>
}

const memory = new Map<string, FallbackStore>()
const STORAGE_PREFIX = 'novelforge-fallback:'

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

function exportText(store: FallbackStore, format: 'markdown' | 'txt') {
  const output = format === 'markdown'
    ? '# ' + store.data.project.title + '\n\n作者：' + store.data.project.author + '\n\n'
    : store.data.project.title + '\n作者：' + store.data.project.author + '\n\n'
  const volumes = store.data.nodes.filter((item) => item.kind === 'volume').sort((a, b) => a.orderIndex - b.orderIndex)
  const rendered = volumes.map((volume) => {
    const chapters = store.data.nodes.filter((item) => item.parentId === volume.id).sort((a, b) => a.orderIndex - b.orderIndex)
    const volumeTitle = format === 'markdown' ? '\n# ' + volume.title + '\n' : '\n' + volume.title + '\n'
    const chapterText = chapters.map((chapter) => {
      const chapterContent = store.documents[chapter.id] ?? ''
      const heading = format === 'markdown' ? '\n## ' + chapter.title + '\n' : '\n' + chapter.title + '\n'
      return heading + '\n' + chapterContent.replace(/^# .*\n?/u, '').trim() + '\n'
    }).join('')
    return volumeTitle + chapterText
  }).join('')
  return output + rendered
}

export async function fallbackInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (command === 'create_project') {
    const input = args.input as ProjectInput
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
    return { node: current, content: store.documents[id] ?? '' } as T
  }
  if (command === 'create_node') {
    const kind = input?.kind as NodeRecord['kind']
    const parentId = (input?.parentId as string | null) ?? null
    const title = input?.title as string
    const siblings = store.data.nodes.filter((item) => item.parentId === parentId && item.kind === kind)
    const orderIndex = siblings.length
    const createdAt = new Date().toISOString()
    const id = uid()
    const prefix = kind === 'chapter' ? 'manuscript/chapter' : 'manuscript/section'
    const filePath = kind === 'volume'
      ? 'manuscript/volume_' + String(orderIndex + 1).padStart(3, '0')
      : prefix + '_' + String(orderIndex + 1).padStart(3, '0') + '.md'
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
    current.title = input?.title as string
    current.updatedAt = new Date().toISOString()
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'set_node_status') {
    const current = node(store, input?.nodeId as string)
    if (!current) throw new Error('节点不存在')
    current.status = input?.status as string
    current.updatedAt = new Date().toISOString()
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'reorder_node') {
    const current = node(store, input?.nodeId as string)
    if (current) {
      const direction = input?.direction === 'up' ? -1 : 1
      const other = store.data.nodes.find((item) => item.parentId === current.parentId && item.orderIndex === current.orderIndex + direction)
      if (other) {
        other.orderIndex = current.orderIndex
        current.orderIndex += direction
        persist(projectPath, store)
      }
    }
    return store.data as T
  }
  if (command === 'save_document') {
    const id = input?.nodeId as string
    const current = node(store, id)
    if (!current) throw new Error('章节不存在')
    const content = input?.content as string
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
    store.documents[item.nodeId] = item.content
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'list_recovery') return store.data.recovery as T
  if (command === 'read_recovery') throw new Error('浏览器 fallback 没有未完成恢复文件')
  if (command === 'restore_recovery' || command === 'discard_recovery') return store.data as T
  if (command === 'upsert_entity') {
    const entityInput = input as unknown as EntityInput
    const existing = entityInput.id ? entity(store, entityInput.id) : undefined
    const current: EntityRecord = existing ?? {
      id: entityInput.id ?? uid(), kind: entityInput.kind, title: entityInput.title,
      content: {}, tags: [], filePath: entityInput.kind + '/' + uid() + '.md',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    current.kind = entityInput.kind
    current.title = entityInput.title
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
    if (current) {
      store.data.entities = store.data.entities.filter((item) => item.id !== current.id)
      store.trash.push({ id: uid(), refId: current.id, refKind: 'entity', title: current.title, originalPath: current.filePath, trashPath: 'fallback://trash', deletedAt: new Date().toISOString() })
      persist(projectPath, store)
    }
    return store.data as T
  }
  if (command === 'delete_node') {
    const id = input?.nodeId as string
    const current = node(store, id)
    if (current) {
      store.data.nodes = store.data.nodes.filter((item) => item.id !== id && item.parentId !== id)
      delete store.documents[id]
      store.trash.push({ id: uid(), refId: id, refKind: 'node', title: current.title, originalPath: current.filePath, trashPath: 'fallback://trash', deletedAt: new Date().toISOString() })
      persist(projectPath, store)
    }
    return store.data as T
  }
  if (command === 'list_trash') return store.trash as T
  if (command === 'restore_trash') {
    const trash = store.trash.find((item) => item.id === input?.nodeId)
    if (trash) {
      store.trash = store.trash.filter((item) => item.id !== trash.id)
      persist(projectPath, store)
    }
    return store.data as T
  }
  if (command === 'permanent_delete') {
    store.trash = store.trash.filter((item) => item.id !== input?.nodeId)
    persist(projectPath, store)
    return store.data as T
  }
  if (command === 'search_project') {
    const search = args.input as SearchInput
    const query = search.query.toLocaleLowerCase()
    const results: SearchResult[] = []
    for (const item of store.data.nodes.filter((candidate) => candidate.kind !== 'volume')) {
      const content = store.documents[item.id] ?? ''
      if ((!search.kind || search.kind === 'manuscript') && (item.title + content).toLocaleLowerCase().includes(query)) {
        results.push({ id: item.id, kind: item.kind, title: item.title, path: item.filePath, snippet: content.slice(0, 160) })
      }
    }
    for (const item of store.data.entities) {
      const content = JSON.stringify(item.content)
      if ((!search.kind || search.kind === item.kind) && (item.title + content).toLocaleLowerCase().includes(query)) {
        results.push({ id: item.id, kind: item.kind, title: item.title, path: item.filePath, snippet: content.slice(0, 160) })
      }
    }
    return results.slice(0, 100) as T
  }
  if (command === 'get_statistics') {
    let total = 0
    for (const content of Object.values(store.documents)) total += countWords(content)
    const today = new Date().toDateString()
    const todayWords = store.activities.filter((item) => new Date(item.createdAt).toDateString() === today).reduce((sum, item) => sum + Math.max(0, item.deltaWords), 0)
    return {
      totalWords: total, todayWords, yesterdayWords: 0, weekWords: todayWords, monthWords: todayWords,
      chapterCount: store.data.nodes.filter((item) => item.kind === 'chapter').length,
      targetWords: store.data.project.targetWords, writingStreak: todayWords > 0 ? 1 : 0,
    } as T
  }
  if (command === 'export_project') {
    const exportInput = args.input as ExportInput
    void exportText(store, exportInput.format === 'txt' ? 'txt' : 'markdown')
    return ('browser://exports/' + store.data.project.title + '.' + exportInput.format) as T
  }
  if (command === 'update_project') {
    const update = input as unknown as ProjectInput
    store.data.project.title = update.title
    store.data.project.author = update.author
    store.data.project.description = update.description
    store.data.project.genre = update.genre
    store.data.project.targetWords = update.targetWords
    updateTime(store.data)
    persist(projectPath, store)
    return store.data as T
  }
  throw new Error('开发模式暂不支持命令：' + command)
}
