import { useState } from 'react'
import { BookOpen, GalleryVerticalEnd, LayoutDashboard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import '../planning.css'
import { sortChapterNodes } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import { KanbanView } from './KanbanView'
import { OutlineView } from './OutlineView'
import { SceneView } from './SceneView'

type PlanningTab = 'outline' | 'scene' | 'board'

export function PlanningView() {
  const data = useAppStore((state) => state.data)
  const [tab, setTab] = useState<PlanningTab>('outline')
  const firstChapter = sortChapterNodes(data?.nodes ?? [])[0]?.id ?? ''
  const [chapterId, setChapterId] = useState(firstChapter)
  const tabs: Array<{ id: PlanningTab; label: string; icon: LucideIcon }> = [
    { id: 'outline', label: '章节大纲', icon: BookOpen },
    { id: 'scene', label: '场景卡', icon: GalleryVerticalEnd },
    { id: 'board', label: '写作看板', icon: LayoutDashboard },
  ]

  return <div className="planning-view workspace-view"><div className="planning-topbar"><div><p className="eyebrow">STORY PLANNING</p><h1>写作规划</h1><p>把结构、场景和正文状态放在同一条创作链路里。</p></div><div className="planning-tabs" role="tablist" aria-label="写作规划视图">{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={14} />{label}</button>)}</div></div>{tab === 'outline' ? <OutlineView /> : tab === 'scene' ? <SceneView chapterId={chapterId} onChapterChange={setChapterId} /> : <KanbanView />}</div>
}
