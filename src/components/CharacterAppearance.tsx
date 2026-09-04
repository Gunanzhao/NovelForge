import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, RefreshCw, Users } from 'lucide-react'
import {
  buildCharacterAppearance, chapterMentionRows, matrixWindow, scanProjectMentionIndex,
} from '../lib/character-appearance'
import type { CharacterAppearance as CharacterAppearanceData } from '../lib/character-appearance'
import type { MentionIndex } from '../lib/mention-detection'
import { useAppStore } from '../stores/app-store'
import { Button, Panel } from './ui'

function useMentionIndex() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const setError = useAppStore((state) => state.setError)
  const [index, setIndex] = useState<MentionIndex | null>(null)
  const [busy, setBusy] = useState(false)
  const scan = useCallback(async (force = false) => {
    if (!data || !projectPath) return
    setBusy(true)
    try {
      setIndex(await scanProjectMentionIndex(projectPath, data, force))
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }, [data, projectPath, setError])
  useEffect(() => { void scan(false) }, [scan])
  return { data, index, busy, scan }
}

function AppearanceDetails({ appearance }: { appearance: CharacterAppearanceData }) {
  const selectNode = useAppStore((state) => state.selectNode)
  return <div className="appearance-details">
    <div className="appearance-metrics"><div><span>首次登场</span><strong>{appearance.firstChapter?.title ?? '尚未出现'}</strong></div><div><span>最近登场</span><strong>{appearance.recentChapter?.title ?? '尚未出现'}</strong></div><div><span>出现章节</span><strong>{appearance.chapters.length}</strong></div><div><span>正文提及</span><strong>{appearance.totalMentions}</strong></div></div>
    <div className="appearance-columns"><div><h4>出现章节</h4>{appearance.chapters.length ? appearance.chapters.map((chapter) => <button key={chapter.node.id} onClick={() => void selectNode(chapter.node.id)}><span>{chapter.node.title}</span><small>{chapter.mentions} 次</small></button>) : <span className="field-hint">正文中还没有识别到该人物。</span>}</div><div><h4>共同出现人物</h4>{appearance.companions.length ? appearance.companions.map((item) => <button key={item.entity.id} onClick={() => useAppStore.getState().selectEntity('character', item.entity.id)}><span>{item.entity.title}</span><small>{item.chapters} 章</small></button>) : <span className="field-hint">暂无共同出现人物。</span>}<h4>主要地点</h4>{appearance.locations.length ? appearance.locations.map((item) => <button key={item.entity.id} onClick={() => useAppStore.getState().selectEntity('location', item.entity.id)}><span>{item.entity.title}</span><small>{item.chapters} 章</small></button>) : <span className="field-hint">暂无主要地点。</span>}</div></div>
  </div>
}

export function CharacterAppearancePanel({ characterId }: { characterId: string }) {
  const { data, index, busy, scan } = useMentionIndex()
  const appearance = useMemo(() => data && index ? buildCharacterAppearance(data, index, characterId) : null, [characterId, data, index])
  return <div className="entity-reference-panel character-appearance-panel"><div className="panel-title"><h3>出场统计</h3><span>{busy ? '扫描中…' : '由正文重建'}</span></div>{appearance ? <AppearanceDetails appearance={appearance} /> : <span className="field-hint">正在读取章节并建立出场统计…</span>}<div className="inspector-actions"><Button variant="ghost" disabled={busy} onClick={() => void scan(true)}><RefreshCw size={12} />重新扫描全文</Button><Button variant="ghost" onClick={() => useAppStore.getState().setView('character-statistics')}><BarChart3 size={12} />打开矩阵</Button></div></div>
}

export function CharacterStatisticsView() {
  const { data, index, busy, scan } = useMentionIndex()
  const selectedEntityId = useAppStore((state) => state.selectedEntityId)
  const [chapterPage, setChapterPage] = useState(0)
  const [characterPage, setCharacterPage] = useState(0)
  const characters = useMemo(() => (data?.entities ?? []).filter((entity) => entity.kind === 'character').sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')), [data?.entities])
  const selectedId = characters.some((item) => item.id === selectedEntityId) ? selectedEntityId : characters[0]?.id
  const appearance = useMemo(() => data && index && selectedId ? buildCharacterAppearance(data, index, selectedId) : null, [data, index, selectedId])
  const rows = useMemo(() => data && index ? chapterMentionRows(data, index) : [], [data, index])
  const chapterWindow = matrixWindow(rows, chapterPage, 40)
  const characterWindow = matrixWindow(characters, characterPage, 12)

  if (!data) return null
  return <div className="workspace-view character-statistics-view">
    <div className="view-header"><div><p className="eyebrow">CHARACTER ANALYTICS</p><h1>人物出场统计</h1><p>统计由 P1 Mention Scanner 从正文按需重建；节内容归并到所属章节。</p></div><Button variant="outline" disabled={busy} onClick={() => void scan(true)}><RefreshCw size={14} />{busy ? '扫描中…' : '重新扫描全文'}</Button></div>
    <div className="character-statistics-layout"><aside><h3>人物</h3>{characters.map((character) => <button key={character.id} className={character.id === selectedId ? 'active' : ''} onClick={() => useAppStore.setState({ selectedEntityId: character.id })}>{character.title}</button>)}</aside><Panel>{appearance ? <AppearanceDetails appearance={appearance} /> : <div className="empty-state"><Users size={24} /><span>{busy ? '正在读取正文…' : '请选择人物。'}</span></div>}</Panel></div>
    <Panel className="character-matrix"><div className="panel-title"><h3>章节人物矩阵</h3><span>窗口：最多 40 章 × 12 人物</span></div><div className="matrix-controls"><span>章节 {chapterWindow.page + 1}/{chapterWindow.pageCount}</span><Button variant="ghost" disabled={chapterWindow.page === 0} onClick={() => setChapterPage((page) => page - 1)}><ChevronLeft size={12} /></Button><Button variant="ghost" disabled={chapterWindow.page === chapterWindow.pageCount - 1} onClick={() => setChapterPage((page) => page + 1)}><ChevronRight size={12} /></Button><span>人物 {characterWindow.page + 1}/{characterWindow.pageCount}</span><Button variant="ghost" disabled={characterWindow.page === 0} onClick={() => setCharacterPage((page) => page - 1)}><ChevronLeft size={12} /></Button><Button variant="ghost" disabled={characterWindow.page === characterWindow.pageCount - 1} onClick={() => setCharacterPage((page) => page + 1)}><ChevronRight size={12} /></Button></div><div className="character-matrix-scroll"><table><thead><tr><th>章节</th>{characterWindow.items.map((character) => <th key={character.id}>{character.title}</th>)}</tr></thead><tbody>{chapterWindow.items.map((row) => <tr key={row.chapter.id}><th><button onClick={() => void useAppStore.getState().selectNode(row.chapter.id)}>{row.chapter.title}</button></th>{characterWindow.items.map((character) => <td key={character.id}>{row.entityIds.has(character.id) ? <span title={`${row.counts.get(character.id) ?? 0} 次`}>●</span> : null}</td>)}</tr>)}</tbody></table></div></Panel>
  </div>
}
