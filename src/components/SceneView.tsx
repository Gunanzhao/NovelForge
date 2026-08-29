import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, GripVertical, Plus, Save, Trash2 } from 'lucide-react'
import type { EntityRecord } from '../lib/types'
import { contentNumber, contentText, reorderItems, sortChapterNodes, sortPlanningEntities } from '../lib/planning-data'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'

interface SceneDraft {
  title: string
  pov: string
  location: string
  time: string
  characters: string
  goal: string
  conflict: string
  result: string
  notes: string
}

function blankDraft(): SceneDraft {
  return { title: '', pov: '', location: '', time: '', characters: '', goal: '', conflict: '', result: '', notes: '' }
}

function sceneDraft(scene: EntityRecord | undefined): SceneDraft {
  const next = blankDraft()
  if (!scene) return next
  next.title = scene.title
  next.pov = contentText(scene, 'pov')
  next.location = contentText(scene, 'location')
  next.time = contentText(scene, 'time')
  next.characters = contentText(scene, 'characters')
  next.goal = contentText(scene, 'goal')
  next.conflict = contentText(scene, 'conflict')
  next.result = contentText(scene, 'result')
  next.notes = contentText(scene, 'notes')
  return next
}

export function SceneView({ chapterId, onChapterChange }: { chapterId: string; onChapterChange: (id: string) => void }) {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const deleteEntity = useAppStore((state) => state.deleteEntity)
  const setError = useAppStore((state) => state.setError)
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<SceneDraft>(blankDraft)
  const [busy, setBusy] = useState(false)
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null)

  const chapters = useMemo(() => sortChapterNodes(data?.nodes ?? []), [data?.nodes])
  const scenes = useMemo(() => sortPlanningEntities((data?.entities ?? []).filter((entity) => entity.kind === 'scene' && contentText(entity, 'chapterId') === chapterId)), [data?.entities, chapterId])
  const selectedScene = scenes.find((scene) => scene.id === editingSceneId)

  useEffect(() => {
    if (!chapters.some((chapter) => chapter.id === chapterId)) onChapterChange(chapters[0]?.id ?? '')
  }, [chapters, chapterId, onChapterChange])

  useEffect(() => {
    if (!creating && editingSceneId && !selectedScene) setEditingSceneId(scenes[0]?.id ?? null)
    if (!creating && !editingSceneId && scenes.length) setEditingSceneId(scenes[0].id)
  }, [creating, editingSceneId, scenes, selectedScene])

  useEffect(() => {
    setDraft(creating ? blankDraft() : sceneDraft(selectedScene))
  }, [creating, selectedScene])

  if (!data || !projectPath) return null
  const currentProjectPath = projectPath

  function updateField(key: keyof SceneDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function startNew() {
    setCreating(true)
    setEditingSceneId(null)
  }

  async function save() {
    if (!chapterId || !draft.title.trim()) return
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath, kind: 'scene', id: creating ? null : selectedScene?.id ?? null, title: draft.title.trim(),
        content: {
          chapterId, order: creating ? scenes.length : contentNumber(selectedScene, 'order', scenes.findIndex((item) => item.id === selectedScene?.id)),
          pov: draft.pov, location: draft.location, time: draft.time, characters: draft.characters,
          goal: draft.goal, conflict: draft.conflict, result: draft.result, notes: draft.notes,
        }, tags: ['场景卡'],
      })
      setCreating(false)
      const refreshed = useAppStore.getState().data?.entities ?? []
      const saved = refreshed.filter((entity) => entity.kind === 'scene' && contentText(entity, 'chapterId') === chapterId && entity.title === draft.title.trim()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      setEditingSceneId(saved?.id ?? null)
    } catch (error) { setError(error) } finally { setBusy(false) }
  }

  async function remove() {
    if (!selectedScene || !window.confirm('将“' + selectedScene.title + '”移入回收站？')) return
    try { await deleteEntity(selectedScene.id); setEditingSceneId(null) } catch (error) { setError(error) }
  }

  async function persistOrder(next: EntityRecord[]) {
    if (next.length < 2) return
    setBusy(true)
    try {
      for (const [index, scene] of next.entries()) {
        if (contentText(scene, 'order').trim() === String(index)) continue
        await saveEntity({ projectPath: currentProjectPath, kind: 'scene', id: scene.id, title: scene.title, content: { ...scene.content, chapterId, order: index }, tags: scene.tags })
      }
    } catch (error) { setError(error) } finally { setBusy(false); setDraggedSceneId(null) }
  }

  function moveScene(sceneId: string, direction: -1 | 1) {
    const index = scenes.findIndex((scene) => scene.id === sceneId)
    const target = scenes[index + direction]
    if (target) void persistOrder(reorderItems(scenes, sceneId, target.id))
  }

  return <div className="scene-workspace"><div className="scene-list-column"><div className="planning-column-head"><div><p className="eyebrow">SCENE CARDS</p><h3>场景卡</h3></div><Button onClick={startNew}><Plus size={14} />新建场景</Button></div><select className="select-input" value={chapterId} onChange={(event) => { setCreating(false); setEditingSceneId(null); onChapterChange(event.target.value) }}><option value="">选择章节</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select><div className="scene-list">{scenes.length ? scenes.map((scene, index) => <div key={scene.id} className={'scene-list-card' + (scene.id === editingSceneId && !creating ? ' active' : '')} draggable={!busy} onDragStart={() => setDraggedSceneId(scene.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedSceneId) void persistOrder(reorderItems(scenes, draggedSceneId, scene.id)) }} onDragEnd={() => setDraggedSceneId(null)}><button className="scene-card-main" onClick={() => { setCreating(false); setEditingSceneId(scene.id) }}><GripVertical size={14} className="scene-drag-handle" /><span><strong>{index + 1}. {scene.title}</strong><small>{[contentText(scene, 'pov'), contentText(scene, 'location'), contentText(scene, 'goal')].filter(Boolean).join(' · ') || '尚未填写场景摘要'}</small></span></button><div className="scene-card-actions"><button aria-label="上移场景" title="上移场景" disabled={busy || index === 0} onClick={() => moveScene(scene.id, -1)}><ArrowUp size={13} /></button><button aria-label="下移场景" title="下移场景" disabled={busy || index === scenes.length - 1} onClick={() => moveScene(scene.id, 1)}><ArrowDown size={13} /></button></div></div>) : <div className="empty-state"><BookOpen size={24} /><div><strong>还没有场景卡</strong><span>场景卡可以拖动排序，并在保存后成为项目中的 Markdown 资料。</span></div></div>}</div></div><section className="scene-editor"><Panel className="planning-card">{chapterId ? <><div className="planning-card-head"><div><p className="eyebrow">SCENE DETAIL</p><h3>{creating ? '新建场景' : selectedScene?.title ?? '选择场景'}</h3></div><span className="planning-state">{busy ? '保存中…' : '本地资料'}</span></div><div className="planning-form"><Field label="场景标题"><TextInput autoFocus={creating} value={draft.title} onChange={(event) => updateField('title', event.target.value)} placeholder="例如：雾港的钟声" /></Field><div className="field-grid"><Field label="POV"><TextInput value={draft.pov} onChange={(event) => updateField('pov', event.target.value)} placeholder="视角人物" /></Field><Field label="地点"><TextInput value={draft.location} onChange={(event) => updateField('location', event.target.value)} placeholder="发生地点" /></Field></div><div className="field-grid"><Field label="时间"><TextInput value={draft.time} onChange={(event) => updateField('time', event.target.value)} placeholder="时间 / 时段" /></Field><Field label="参与人物"><TextInput value={draft.characters} onChange={(event) => updateField('characters', event.target.value)} placeholder="用逗号分隔人物" /></Field></div><Field label="目标"><textarea className="text-area" value={draft.goal} onChange={(event) => updateField('goal', event.target.value)} placeholder="场景中的角色想得到什么？" /></Field><Field label="冲突"><textarea className="text-area" value={draft.conflict} onChange={(event) => updateField('conflict', event.target.value)} placeholder="阻力、误会或对抗是什么？" /></Field><Field label="结果"><textarea className="text-area" value={draft.result} onChange={(event) => updateField('result', event.target.value)} placeholder="场景结束时发生了什么变化？" /></Field><Field label="备注"><textarea className="text-area compact" value={draft.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="写作提示…" /></Field><div className="entity-actions"><Button onClick={() => void save()} disabled={busy || !draft.title.trim()}><Save size={14} />{busy ? '保存中…' : '保存场景卡'}</Button>{selectedScene && !creating ? <Button variant="danger" onClick={() => void remove()}><Trash2 size={14} />移入回收站</Button> : null}</div></div></> : <div className="empty-state"><BookOpen size={25} /><div><strong>请先选择章节</strong><span>场景卡需要关联到一个章节。</span></div></div>}</Panel></section></div>
}
