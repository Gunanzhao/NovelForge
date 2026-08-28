export type NodeKind = 'volume' | 'chapter' | 'section'
export type EntityKind = 'character' | 'location' | 'world' | 'timeline' | 'foreshadowing' | 'outline' | 'scene' | 'note'
export type ViewId = 'dashboard' | 'manuscript' | EntityKind | 'search' | 'trash' | 'settings'
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export type ThemeMode = 'light' | 'dark' | 'system'

export interface ProjectMetadata {
  formatVersion: number
  id: string
  title: string
  author: string
  description: string
  genre: string
  targetWords: number
  createdAt: string
  updatedAt: string
}

export interface NodeRecord {
  id: string
  kind: NodeKind
  parentId: string | null
  title: string
  orderIndex: number
  status: string
  filePath: string
  createdAt: string
  updatedAt: string
}

export interface EntityRecord {
  id: string
  kind: EntityKind
  title: string
  content: Record<string, unknown>
  tags: string[]
  filePath: string
  createdAt: string
  updatedAt: string
}

export interface RecoveryItem {
  id: string
  nodeId: string
  nodeTitle: string
  path: string
  createdAt: string
}

export interface HistoryItem {
  id: string
  nodeId: string
  nodeTitle: string
  reason: string
  wordCount: number
  createdAt: string
  path: string
}

export interface TrashItem {
  id: string
  refId: string
  refKind: 'node' | 'entity'
  title: string
  originalPath: string
  trashPath: string
  deletedAt: string
}

export interface ProjectData {
  project: ProjectMetadata
  nodes: NodeRecord[]
  entities: EntityRecord[]
  recovery: RecoveryItem[]
}

export interface DocumentData {
  node: NodeRecord
  content: string
}

export interface Stats {
  totalWords: number
  todayWords: number
  yesterdayWords: number
  weekWords: number
  monthWords: number
  chapterCount: number
  targetWords: number
  writingStreak: number
}

export interface SearchResult {
  id: string
  kind: string
  title: string
  path: string
  snippet: string
}

export interface EntityDraft {
  title: string
  tags: string
  fields: Record<string, string>
}

export const ENTITY_LABELS: Record<EntityKind, string> = {
  character: '人物',
  location: '地点',
  world: '世界观',
  timeline: '时间线',
  foreshadowing: '伏笔',
  outline: '大纲',
  scene: '场景',
  note: '笔记',
}

export const NODE_STATUS_LABELS: Record<string, string> = {
  'not-started': '未开始',
  draft: '草稿',
  editing: '修改中',
  done: '完成',
  locked: '锁定',
}

export const ENTITY_FIELDS: Record<EntityKind, Array<{ key: string; label: string; multiline?: boolean }>> = {
  character: [
    { key: 'alias', label: '别名' }, { key: 'gender', label: '性别' }, { key: 'age', label: '年龄' },
    { key: 'identity', label: '身份 / 职业' }, { key: 'faction', label: '阵营' },
    { key: 'appearance', label: '外貌', multiline: true }, { key: 'personality', label: '性格', multiline: true },
    { key: 'ability', label: '能力与弱点', multiline: true }, { key: 'background', label: '背景 / 动机 / 秘密', multiline: true },
    { key: 'status', label: '当前状态' }, { key: 'notes', label: '备注', multiline: true },
  ],
  location: [
    { key: 'type', label: '类型' }, { key: 'parent', label: '所属地点' }, { key: 'description', label: '描述', multiline: true },
    { key: 'climate', label: '人口 / 气候', multiline: true }, { key: 'history', label: '历史', multiline: true },
    { key: 'factions', label: '势力' }, { key: 'notes', label: '备注', multiline: true },
  ],
  world: [
    { key: 'category', label: '分类' }, { key: 'summary', label: '摘要', multiline: true },
    { key: 'description', label: '正文', multiline: true }, { key: 'notes', label: '备注', multiline: true },
  ],
  timeline: [
    { key: 'date', label: '日期' }, { key: 'time', label: '时间' }, { key: 'description', label: '事件描述', multiline: true },
    { key: 'characters', label: '参与人物' }, { key: 'location', label: '地点' }, { key: 'chapters', label: '关联章节' },
  ],
  foreshadowing: [
    { key: 'description', label: '说明', multiline: true }, { key: 'plantedIn', label: '首次埋设章节' },
    { key: 'plannedPayoff', label: '计划回收章节' }, { key: 'actualPayoff', label: '实际回收章节' },
    { key: 'status', label: '状态' }, { key: 'notes', label: '备注', multiline: true },
  ],
  outline: [
    { key: 'goal', label: '章节目标', multiline: true }, { key: 'conflict', label: '主要冲突', multiline: true },
    { key: 'events', label: '重要事件', multiline: true }, { key: 'result', label: '结果', multiline: true },
  ],
  scene: [
    { key: 'pov', label: 'POV' }, { key: 'location', label: '地点' }, { key: 'time', label: '时间' },
    { key: 'characters', label: '参与人物' }, { key: 'goal', label: '目标', multiline: true },
    { key: 'conflict', label: '冲突', multiline: true }, { key: 'result', label: '结果', multiline: true },
  ],
  note: [
    { key: 'summary', label: '摘要', multiline: true }, { key: 'description', label: '内容', multiline: true },
  ],
}
