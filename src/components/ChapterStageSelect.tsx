import { useState } from 'react'
import { CHAPTER_STAGES, chapterStage, type ChapterStage } from '../lib/chapter-workflow'
import type { EntityRecord, NodeRecord } from '../lib/types'
import { useAppStore } from '../stores/app-store'

export function ChapterStageSelect({ chapter, entities, label = '写作阶段', className = 'select-input' }: {
  chapter: NodeRecord; entities: EntityRecord[]; label?: string; className?: string
}) {
  const [busy, setBusy] = useState(false)
  async function change(stage: ChapterStage) {
    setBusy(true)
    try { await useAppStore.getState().setChapterStage(chapter.id, stage) }
    catch { /* The store displays the failure and leaves the persisted stage unchanged. */ }
    finally { setBusy(false) }
  }
  return <select aria-label={label} className={className} value={chapterStage(chapter, entities)} disabled={busy}
    onClick={event => event.stopPropagation()} onChange={event => void change(event.target.value as ChapterStage)}>
    {CHAPTER_STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
  </select>
}
