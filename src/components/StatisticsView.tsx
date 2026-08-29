import { useMemo, useState } from 'react'
import { BarChart3, BookOpen, CalendarDays, RefreshCw, Target, TrendingUp } from 'lucide-react'
import { formatDate } from '../lib/utils'
import { formatNumber } from '../lib/utils'
import { useAppStore } from '../stores/app-store'
import { Button, Panel } from './ui'

export function StatisticsView() {
  const stats = useAppStore((state) => state.stats)
  const refreshStats = useAppStore((state) => state.refreshStats)
  const [busy, setBusy] = useState(false)
  const maxDaily = Math.max(1, ...stats.daily.map((item) => item.words))
  const maxChapter = Math.max(1, ...stats.chapterStats.map((item) => item.words))
  const activeDays = stats.daily.filter((item) => item.words > 0).length
  const averageChapter = stats.chapterCount ? Math.round(stats.totalWords / stats.chapterCount) : 0
  const topChapters = useMemo(() => stats.chapterStats.slice(0, 12), [stats.chapterStats])

  async function refresh() {
    setBusy(true)
    try { await refreshStats() } finally { setBusy(false) }
  }

  return <div className="workspace-view statistics-view"><div className="view-header"><div><p className="eyebrow">WRITING ANALYTICS</p><h1>详细统计</h1><p>查看近 30 日写作趋势、章节字数分布和目标完成情况；统计来自本地 Markdown 正文和保存记录。</p></div><Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} className={busy ? 'spin' : ''} />{busy ? '刷新中…' : '刷新统计'}</Button></div><div className="statistics-metrics"><Panel><span><BookOpen size={14} />总字数</span><strong>{formatNumber(stats.totalWords)}</strong><small>{formatNumber(stats.chapterCount)} 个章节</small></Panel><Panel><span><TrendingUp size={14} />章节均值</span><strong>{formatNumber(averageChapter)}</strong><small>每章平均字数</small></Panel><Panel><span><CalendarDays size={14} />活跃天数</span><strong>{activeDays}</strong><small>近 30 日</small></Panel><Panel><span><Target size={14} />目标进度</span><strong>{stats.targetWords ? `${Math.min(100, Math.round(stats.totalWords / stats.targetWords * 100))}%` : '—'}</strong><small>{formatNumber(stats.targetWords)} 字目标</small></Panel></div><div className="statistics-grid"><Panel className="statistics-panel"><div className="panel-title"><h3>近 30 日写作趋势</h3><span>每日新增字数</span></div><div className="daily-chart" aria-label="近 30 日写作趋势">{stats.daily.map((item) => <div className="daily-bar-wrap" key={item.date} title={`${item.date}：${formatNumber(item.words)} 字`}><div className="daily-bar" style={{ height: `${Math.max(item.words ? 6 : 2, item.words / maxDaily * 100)}%` }} /><span>{item.date.slice(5)}</span></div>)}</div></Panel><Panel className="statistics-panel"><div className="panel-title"><h3>章节字数排行</h3><span>按正文字符数</span></div>{topChapters.length ? <div className="chapter-stats-list">{topChapters.map((chapter, index) => <div className="chapter-stat" key={chapter.id}><span className="chapter-stat-rank">{String(index + 1).padStart(2, '0')}</span><span className="chapter-stat-copy"><strong>{chapter.title}</strong><small>{formatDate(chapter.updatedAt)}</small></span><span className="chapter-stat-value">{formatNumber(chapter.words)} 字</span><span className="chapter-stat-track"><i style={{ width: `${chapter.words / maxChapter * 100}%` }} /></span></div>)}</div> : <div className="empty-state"><BarChart3 size={24} /><div><strong>还没有章节统计</strong><span>保存正文后，这里会显示章节字数排行。</span></div></div>}</Panel></div><Panel className="statistics-note"><BarChart3 size={15} /><span><strong>统计口径</strong>总字数按当前 Markdown 正文的非空白字符计算；趋势按保存时记录的新增字数累计，删除字符不会计入新增。</span></Panel></div>
}

