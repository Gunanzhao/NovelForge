import { useUnsavedDraft } from '../hooks/useUnsavedDraft'
import { markDraftSaved, setDraftSaving } from '../lib/draft-guard'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ListChecks, RefreshCw, Save } from 'lucide-react'
import {
  checklistForChapter, checklistProgress, CHAPTER_WORKFLOW_STATUSES, chapterStageLabel,
  DEFAULT_CHECKLIST_TEMPLATE, parseChecklistTemplate, workflowDashboard,
} from '../lib/chapter-workflow'
import type { ChapterChecklist } from '../lib/chapter-workflow'
import { useAppStore } from '../stores/app-store'
import { ChapterStageSelect } from './ChapterStageSelect'
import { Button, Field, Panel } from './ui'

export function ChecklistTemplateSettings() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const setError = useAppStore((state) => state.setError)
  const templateEntity = data?.entities.find((entity) => entity.kind === 'checklist-template')
  const savedText = parseChecklistTemplate(templateEntity).items.map(item => item.label).join('\n')
  const [text, setText] = useState(savedText)
  const draftId = 'checklist-template:' + projectPath
  useUnsavedDraft(draftId, '章节完成模板', text !== savedText, save, () => setText(savedText), { targetId: draftId, payload: { text } })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setText(parseChecklistTemplate(templateEntity).items.map((item) => item.label).join('\n'))
  }, [templateEntity])
  if (!data || !projectPath) return null
  const currentProjectPath = projectPath
  async function save() {
    const labels = text.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)
    if (!labels.length) { setError('Checklist 模板至少需要一个检查项。'); return false }
    if (busy) return false
    setDraftSaving(draftId, true)
    setBusy(true)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'checklist-template',
        id: templateEntity?.id ?? null,
        title: '项目章节 Checklist 模板',
        content: { items: labels.map((label, index) => ({ id: `custom-${index + 1}`, label })) },
        tags: ['章节流程模板'],
      })
      markDraftSaved(draftId); return true
    } catch (error) {
      setError(error); return false
    } finally {
      setDraftSaving(draftId, false); setBusy(false)
    }
  }
  return <Panel className="settings-card checklist-template-settings"><div className="panel-title"><h3>章节 Checklist 模板</h3><span>只影响以后新建的章节</span></div><Field label="检查项" hint="每行一个检查项；修改模板不会覆盖已有章节。"><textarea disabled={busy} className="text-area" value={text} onChange={(event) => setText(event.target.value)} /></Field><div className="view-actions"><Button variant="outline" disabled={busy} onClick={() => setText(DEFAULT_CHECKLIST_TEMPLATE.items.map((item) => item.label).join('\n'))}><RefreshCw size={13} />恢复默认小说模板</Button><Button disabled={busy} onClick={() => void save()}><Save size={13} />{busy ? '保存中…' : '保存模板'}</Button></div></Panel>
}

export function ChapterChecklistInspector() {
  const document = useAppStore((state) => state.document)
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const setError = useAppStore((state) => state.setError)
  const [busy, setBusy] = useState(false)
  const chapter = document?.node.kind === 'chapter' ? document.node : null
  const checklist = chapter && data ? checklistForChapter(data.entities, chapter.id) : null
  const progress = checklistProgress(checklist)

  async function save(update: (value: ChapterChecklist) => ChapterChecklist = value => value) {
    if (!chapter || !data || !projectPath) return
    setBusy(true)
    try {
      await useAppStore.getState().updateChapterChecklist(chapter.id, update)
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  function updateItem(id: string) {
    if (!checklist) return
    void save(value => ({ ...value, items: value.items.map(item => item.id === id ? { ...item, completed: !item.completed } : item) }))
  }

  useEffect(() => {
    const toggle = () => {
      const current = useAppStore.getState()
      const currentDocument = current.document
      if (!currentDocument || currentDocument.node.kind !== 'chapter' || !current.data || !current.projectPath) return
      void current.updateChapterChecklist(currentDocument.node.id, value => {
        const first = value.items.find(item => !item.completed)
        return { ...value, items: value.items.map(item => item.id === first?.id ? { ...item, completed: true } : item) }
      }).catch(() => undefined)
    }
    window.addEventListener('novelforge:toggle-chapter-checklist', toggle)
    return () => window.removeEventListener('novelforge:toggle-chapter-checklist', toggle)
  }, [])

  if (!chapter || !data || !projectPath) return null
  return <div className="chapter-checklist-inspector"><div className="panel-title"><h3><ListChecks size={14} />检查事项</h3><span>{progress.completed} / {progress.total} · {progress.percent}%</span></div>{checklist ? <><ChapterStageSelect chapter={chapter} entities={data.entities} label="章节完成中的写作阶段" /><p className="field-hint">写作阶段与正文、看板及导出一致；勾选检查事项不会自动定稿。</p>{['self-check-complete', 'proofread-1', 'proofread-2'].includes(checklist.workflowStatus) && <p className="field-hint">{chapterStageLabel(chapter, data.entities)} · 保留原细分阶段：{CHAPTER_WORKFLOW_STATUSES.find(item => item.id === checklist.workflowStatus)?.label}</p>}<div className="chapter-checklist-items">{checklist.items.map((item) => <label key={item.id}><input type="checkbox" checked={item.completed} disabled={busy} onChange={() => updateItem(item.id)} /><span>{item.label}</span></label>)}</div><div className="progress-track"><div className="progress-bar" style={{ width: `${progress.percent}%` }} /></div></> : <><span className="field-hint">尚未建立检查清单；初始化会保留当前写作阶段，并复制项目检查模板。</span><Button variant="outline" disabled={busy} onClick={() => void save()}><ListChecks size={13} />初始化 Checklist</Button></>}</div>
}

export function ChecklistDashboard() {
  const data = useAppStore((state) => state.data)
  const summaries = useMemo(() => data ? workflowDashboard(data) : [], [data])
  if (!data) return null
  return <Panel className="dashboard-panel workflow-dashboard"><div className="panel-title"><h3>章节进度</h3><CheckCircle2 size={15} color="var(--green)" /></div>{summaries.length ? summaries.map((summary) => <div className="workflow-volume" key={summary.volume.id}><div><strong>{summary.volume.title}</strong><span>定稿 {summary.finalCount} / {summary.chapterCount}</span></div>{summary.itemProgress.map((item) => <div className="workflow-progress-row" key={item.label}><span>{item.label}</span><strong>{item.completed} / {item.total}</strong></div>)}</div>) : <span className="field-hint">项目还没有卷。</span>}</Panel>
}
