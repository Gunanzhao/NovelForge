import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpen,
  CircleUserRound,
  Clock3,
  FilePlus2,
  GalleryVerticalEnd,
  GitBranch,
  GitCompare,
  Globe2,
  Inbox,
  LayoutDashboard,
  Network,
  Paperclip,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ViewId } from '../lib/types'

export const navItems: Array<{
  id: ViewId
  label: string
  icon: LucideIcon
  group: '写作' | '资料' | '分析与辅助'
}> = [
  { id: 'dashboard', label: '总览', icon: LayoutDashboard, group: '写作' },
  { id: 'manuscript', label: '正文', icon: BookOpen, group: '写作' },
  {
    id: 'revision-workbench',
    label: '整卷修订',
    icon: GitCompare,
    group: '写作',
  },
  {
    id: 'manuscript-import',
    label: '稿件导入',
    icon: FilePlus2,
    group: '写作',
  },
  { id: 'outline', label: '写作规划', icon: BookOpen, group: '写作' },
  { id: 'character', label: '人物', icon: CircleUserRound, group: '资料' },
  { id: 'location', label: '地点', icon: GalleryVerticalEnd, group: '资料' },
  { id: 'world', label: '世界观 Wiki', icon: Globe2, group: '资料' },
  { id: 'timeline', label: '时间线', icon: Clock3, group: '写作' },
  { id: 'foreshadowing', label: '伏笔', icon: GitBranch, group: '写作' },
  { id: 'story-arc', label: '剧情线', icon: GitBranch, group: '写作' },
  { id: 'inbox', label: '灵感箱', icon: Inbox, group: '写作' },
  {
    id: 'relationship',
    label: '人物关系图',
    icon: Network,
    group: '分析与辅助',
  },
  { id: 'attachment', label: '资料附件', icon: Paperclip, group: '资料' },
  { id: 'chapter-memory', label: '章节记忆', icon: BookOpen, group: '写作' },
  { id: 'annotation', label: '批注与修订', icon: ShieldCheck, group: '写作' },
  {
    id: 'consistency',
    label: '一致性检查',
    icon: ShieldCheck,
    group: '分析与辅助',
  },
  { id: 'statistics', label: '详细统计', icon: BarChart3, group: '分析与辅助' },
  { id: 'ai', label: 'AI 辅助', icon: Sparkles, group: '分析与辅助' },
]

export function viewLabel(view: ViewId) {
  return (
    navItems.find((item) => item.id === view)?.label ??
    (
      {
        search: '全文搜索',
        settings: '项目设置',
        trash: '回收站',
        'character-statistics': '人物出场统计',
      } as Partial<Record<ViewId, string>>
    )[view] ??
    '工作区'
  )
}
