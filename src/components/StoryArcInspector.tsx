import { useMemo, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { parseStoryArc, storyArcEntityInputContent } from '../lib/story-arc-data'
import { useAppStore } from '../stores/app-store'
import { Button } from './ui'

export function StoryArcInspector() {
  const document = useAppStore((state) => state.document)
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const setView = useAppStore((state) => state.setView)
  const setError = useAppStore((state) => state.setError)
  const [busyId, setBusyId] = useState<string | null>(null)
  const arcs = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'story-arc'), [data?.entities])
  if (!document || !projectPath) return null
  const currentDocument = document
  const currentProjectPath = projectPath

  async function toggle(arc: typeof arcs[number]) {
    setBusyId(arc.id)
    const content = parseStoryArc(arc)
    const chapterIds = content.chapterIds.includes(currentDocument.node.id)
      ? content.chapterIds.filter((id) => id !== currentDocument.node.id)
      : [...content.chapterIds, currentDocument.node.id]
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'story-arc',
        id: arc.id,
        title: arc.title,
        tags: arc.tags,
        content: storyArcEntityInputContent({ ...content, chapterIds }),
      })
    } catch (error) {
      setError(error)
    } finally {
      setBusyId(null)
    }
  }

  return <div className="story-arc-inspector">
    <div className="panel-title"><h3><GitBranch size={14} />剧情线</h3><Button variant="ghost" onClick={() => setView('story-arc')}>管理</Button></div>
    {arcs.length ? arcs.map((arc) => {
      const linked = parseStoryArc(arc).chapterIds.includes(currentDocument.node.id)
      return <label key={arc.id}><input type="checkbox" checked={linked} disabled={busyId === arc.id} onChange={() => void toggle(arc)} /><span>{arc.title}</span></label>
    }) : <span className="field-hint">尚未创建剧情线。</span>}
  </div>
}
