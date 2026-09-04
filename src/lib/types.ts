export type NodeKind = 'volume' | 'chapter' | 'section'
export type EntityKind = 'character' | 'location' | 'world' | 'timeline' | 'foreshadowing' | 'outline' | 'scene' | 'note' | 'relationship' | 'attachment' | 'mention-ignore'
export type ViewId = 'dashboard' | 'manuscript' | EntityKind | 'consistency' | 'statistics' | 'ai' | 'search' | 'trash' | 'settings'
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export type ThemeMode = 'light' | 'dark' | 'system'
export type ExportFormat = 'markdown' | 'txt' | 'html' | 'docx' | 'epub' | 'pdf'

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

export interface EditorSelection {
  nodeId: string
  from: number
  to: number
  text: string
}

export interface Stats {
  totalWords: number
  currentVolumeWords?: number
  currentChapterWords?: number
  todayWords: number
  yesterdayWords: number
  weekWords: number
  monthWords: number
  chapterCount: number
  targetWords: number
  writingStreak: number
  averageDailyWords?: number
  longestWritingStreak?: number
  daily: DailyStats[]
  chapterStats: ChapterStats[]
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
  relationship: '人物关系',
  attachment: '附件',
  'mention-ignore': '识别忽略项',
}

export const NODE_STATUS_LABELS: Record<string, string> = {
  'not-started': '未开始',
  draft: '草稿',
  'first-draft': '初稿',
  editing: '修改中',
  done: '完成',
  locked: '锁定',
}

export const ENTITY_FIELDS: Record<EntityKind, Array<{ key: string; label: string; multiline?: boolean }>> = {
  character: [
    { key: 'alias', label: '别名' }, { key: 'gender', label: '性别' }, { key: 'age', label: '年龄' }, { key: 'birthday', label: '生日' },
    { key: 'identity', label: '身份 / 职业' }, { key: 'faction', label: '阵营' }, { key: 'avatar', label: '头像路径' },
    { key: 'appearance', label: '外貌', multiline: true }, { key: 'personality', label: '性格', multiline: true },
    { key: 'ability', label: '能力', multiline: true }, { key: 'weakness', label: '弱点', multiline: true },
    { key: 'habit', label: '习惯', multiline: true }, { key: 'background', label: '背景', multiline: true },
    { key: 'goal', label: '目标', multiline: true }, { key: 'motivation', label: '动机', multiline: true }, { key: 'secret', label: '秘密', multiline: true },
    { key: 'firstAppearance', label: '首次登场' }, { key: 'status', label: '当前状态' }, { key: 'notes', label: '备注', multiline: true },
  ],
  location: [
    { key: 'alias', label: '别名' }, { key: 'type', label: '类型' }, { key: 'parentId', label: '所属地点' }, { key: 'description', label: '描述', multiline: true },
    { key: 'population', label: '人口' }, { key: 'climate', label: '气候', multiline: true }, { key: 'history', label: '历史', multiline: true },
    { key: 'factions', label: '势力' }, { key: 'importantCharacters', label: '重要人物' }, { key: 'importantEvents', label: '重要事件' },
    { key: 'relatedChapters', label: '相关章节' }, { key: 'image', label: '图片路径' }, { key: 'notes', label: '备注', multiline: true },
  ],
  world: [
    { key: 'alias', label: '别名' }, { key: 'category', label: '分类' }, { key: 'summary', label: '摘要', multiline: true },
    { key: 'description', label: '正文', multiline: true }, { key: 'notes', label: '备注', multiline: true },
  ],
  timeline: [
    { key: 'date', label: '日期' }, { key: 'time', label: '时间' }, { key: 'description', label: '事件描述', multiline: true },
    { key: 'characters', label: '参与人物' }, { key: 'location', label: '地点' }, { key: 'chapters', label: '关联章节' }, { key: 'tags', label: '标签' },
  ],
  foreshadowing: [
    { key: 'description', label: '说明', multiline: true }, { key: 'plantedIn', label: '首次埋设章节' },
    { key: 'plannedPayoff', label: '计划回收章节' }, { key: 'actualPayoff', label: '实际回收章节' },
    { key: 'status', label: '状态' }, { key: 'notes', label: '备注', multiline: true },
  ],
  outline: [
    { key: 'goal', label: '章节目标', multiline: true }, { key: 'conflict', label: '主要冲突', multiline: true },
    { key: 'events', label: '重要事件', multiline: true }, { key: 'characters', label: '出场人物' }, { key: 'location', label: '地点' },
    { key: 'result', label: '结果', multiline: true },
  ],
  scene: [
    { key: 'pov', label: 'POV' }, { key: 'location', label: '地点' }, { key: 'time', label: '时间' },
    { key: 'characters', label: '参与人物' }, { key: 'goal', label: '目标', multiline: true },
    { key: 'conflict', label: '冲突', multiline: true }, { key: 'result', label: '结果', multiline: true },
  ],
  note: [
    { key: 'summary', label: '摘要', multiline: true }, { key: 'description', label: '内容', multiline: true },
  ],
  relationship: [
    { key: 'fromId', label: '人物 A' }, { key: 'toId', label: '人物 B' }, { key: 'label', label: '关系类型' },
    { key: 'strength', label: '关系强度' }, { key: 'notes', label: '备注', multiline: true },
  ],
  attachment: [
    { key: 'originalName', label: '原始文件名' }, { key: 'mimeType', label: '类型' }, { key: 'sizeBytes', label: '文件大小' },
    { key: 'description', label: '说明', multiline: true },
  ],
  'mention-ignore': [
    { key: 'text', label: '忽略词' }, { key: 'kind', label: '候选类型' },
  ],
}

export interface DailyStats {
  date: string
  words: number
}

export interface ChapterStats {
  id: string
  title: string
  words: number
  updatedAt: string
}

export interface ConsistencyIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  code: string
  title: string
  detail: string
  refId: string
  refKind: string
  path: string
}

export interface ConsistencyReport {
  checkedAt: string
  issueCount: number
  errors: number
  warnings: number
  issues: ConsistencyIssue[]
}

export interface AiCompletionInput {
  endpoint: string
  apiKey: string
  model: string
  systemPrompt: string
  prompt: string
  temperature?: number
  maxTokens?: number
}

export interface AiCompletionResult {
  content: string
  model: string
}
