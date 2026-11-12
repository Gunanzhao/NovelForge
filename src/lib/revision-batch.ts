import type { RevisionChapterSummary } from './revision-workbench'

export interface RevisionFile { name: string; content: string; targetId: string; error: string; saved?: boolean }
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
export function matchRevisionFile(name: string, chapters: RevisionChapterSummary[]) {
  const title = normalized(name.replace(/\.(?:txt|md|markdown)$/iu, ''))
  const matches = chapters.filter(chapter => normalized(chapter.title) === title)
  return matches.length === 1 ? matches[0].nodeId : ''
}
export function revisionFileIssue(file: RevisionFile, files: RevisionFile[], chapters: RevisionChapterSummary[]) {
  if (file.saved) return '已保存为待确认改稿'
  if (file.error) return file.error
  if (!file.targetId) return '未匹配或名称重复，请选择目标'
  const target = chapters.find(chapter => chapter.nodeId === file.targetId)
  if (!target?.available) return '目标正文不可用'
  if (target.confirmedAt) return '本轮已确认，请新建修订轮次'
  if (target.hasCandidate) return '已有改稿，请在单章编辑中处理'
  if (files.filter(other => other.targetId === file.targetId).length > 1) return '多个文件匹配同一章节'
  return ''
}
