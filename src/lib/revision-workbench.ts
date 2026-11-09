import type { DocumentData } from './types'

export interface RevisionRound {
  id: string
  title: string
  selectedNodeId: string
  chapterCount: number
  confirmedCount: number
}

export interface RevisionChapterSummary {
  nodeId: string
  title: string
  hasCandidate: boolean
  confirmedAt: string | null
  available: boolean
}

export interface RevisionChapter {
  nodeId: string
  original: string
  candidate: string | null
  version: number
  confirmedAt: string | null
  currentContent: string | null
  sourceIssue: string | null
}

export interface RevisionRoundView {
  round: RevisionRound
  chapters: RevisionChapterSummary[]
  current: RevisionChapter
}

export interface RevisionTarget {
  projectPath: string
  roundId: string
  nodeId: string
  expectedVersion: number
}

export interface ConfirmedRevision {
  confirmedAt: string
  version: number
  document: DocumentData | null
}
