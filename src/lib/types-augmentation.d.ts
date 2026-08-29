import type { EntityKind } from './types'

declare module './types' {
  interface ProjectInput {
    path: string
    title: string
    author: string
    description: string
    genre: string
    targetWords: number
  }

  interface NodeInput {
    projectPath: string
    kind: NodeKind
    title: string
    parentId: string | null
  }

  interface SaveDocumentInput {
    projectPath: string
    nodeId: string
    content: string
    reason: string
  }

  interface EntityInput {
    projectPath: string
    kind: EntityKind
    id: string | null
    title: string
    content: Record<string, unknown>
    tags: string[]
  }

  interface SearchInput {
    projectPath: string
    query: string
    kind?: string
    scope?: 'project' | 'current'
    nodeId?: string
    volumePath?: string
    tag?: string
    caseSensitive?: boolean
  }

  interface ExportInput {
    projectPath: string
    format: ExportFormat
  }
}
