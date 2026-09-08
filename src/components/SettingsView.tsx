import { useEffect, useRef, useState } from 'react'
import { Check, Copy, FileText, HardDrive, Monitor, Moon, RefreshCw, Save, ShieldCheck, Sun } from 'lucide-react'
import { DEFAULT_WORKSPACE_PREFERENCES } from '../lib/workspace-preferences'
import { isDesktop, projectApi } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import type { ProjectData, ThemeMode } from '../lib/types'
import type { WorkspacePreferences } from '../lib/workspace-preferences'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'
import { ChecklistTemplateSettings } from './ChapterWorkflow'

const sections = [
  ['project', '作品信息'], ['appearance', '外观与布局'], ['editor', '编辑器'],
  ['writing', '写作目标'], ['data', '数据与日志'],
] as const

type Section = typeof sections[number][0]

function NumberSetting({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  function commit() {
    const parsed = Number(draft)
    const bounded = draft.trim() && Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value
    const next = step >= 1 ? Math.round(bounded) : Math.round(bounded * 100) / 100
    setDraft(String(next))
    onChange(next)
  }
  return <div className="settings-number range-field"><div className="settings-number-head"><span>{label}</span><label><input aria-label={`${label}数值`} className="text-input" type="number" min={min} max={max} step={step} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /><span>{unit}</span></label></div><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></div>
}

function ProjectLogs({ projectPath }: { projectPath: string }) {
  const [logs, setLogs] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    setBusy(true); setError('')
    void projectApi.readLogs(projectPath).then(value => { if (!cancelled) setLogs(value) })
      .catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [projectPath, revision])
  return <div className="settings-log-body"><div className="settings-section-heading"><p>查看项目打开、保存和导出等操作记录。</p><Button variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} className={busy ? 'spin' : ''} />刷新日志</Button></div>{error ? <p role="alert" className="settings-inline-error">{error}</p> : null}<pre className="settings-log" aria-busy={busy}>{busy ? '正在读取日志…' : logs || '暂无日志记录。'}</pre></div>
}

export function SettingsView() {
  const projectPath = useAppStore(state => state.projectPath)
  const project = useAppStore(state => state.data?.project)
  if (!project || !projectPath) return null
  return <ProjectSettings key={projectPath} projectPath={projectPath} initialProject={project} />
}

function ProjectSettings({ projectPath, initialProject }: { projectPath: string; initialProject: ProjectData['project'] }) {
  const preferenceError = useAppStore(state => state.preferenceError)
  const theme = useAppStore(state => state.theme)
  const setTheme = useAppStore(state => state.setTheme)
  const preferences = useAppStore(state => state.workspacePreferences)
  const setPreferences = useAppStore(state => state.setWorkspacePreferences)
  const updateProject = useAppStore(state => state.updateProject)
  const [section, setSection] = useState<Section>('project')
  const [draft, setDraft] = useState(() => ({ title: initialProject.title, author: initialProject.author, genre: initialProject.genre, description: initialProject.description, targetWords: String(initialProject.targetWords) }))
  const [baseline, setBaseline] = useState(draft)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [logsOpen, setLogsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const defaults = DEFAULT_WORKSPACE_PREFERENCES
  const updateDraft = (key: keyof typeof draft, value: string) => { setDraft(current => ({ ...current, [key]: value })); setSaveError('') }
  function changeSection(next: Section) { setSection(next); scrollRef.current?.scrollTo?.({ top: 0 }) }
  function preference<K extends keyof WorkspacePreferences>(key: K, value: WorkspacePreferences[K]) { setPreferences({ [key]: value } as Partial<WorkspacePreferences>) }
  async function submit() {
    if (!draft.title.trim()) { setSaveError('请输入作品名。'); return }
    const target = Number(draft.targetWords)
    if (!draft.targetWords.trim() || !Number.isSafeInteger(target) || target < 0) { setSaveError('目标字数需为不小于 0 的整数。'); return }
    setBusy(true); setSaveError('')
    try {
      const saved = { ...draft, title: draft.title.trim(), targetWords: String(target) }
      await updateProject({ ...saved, targetWords: target })
      setDraft(saved); setBaseline(saved)
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  function resetEditor() {
    setPreferences({ editorFontFamily: defaults.editorFontFamily, editorFontSize: defaults.editorFontSize, editorLineHeight: defaults.editorLineHeight, contentWidth: defaults.contentWidth, paragraphSpacing: defaults.paragraphSpacing })
  }
  const heading = (title: string, action?: React.ReactNode) => <div className="settings-section-heading"><h2>{title}</h2><div><span className="settings-instant"><Check size={12} />{preferenceError ? '本次生效 · 尚未保存' : '即时生效 · 自动保存'}</span>{action}</div></div>
  return <div className="settings-view">
    <header className="settings-page-header"><h1>设置</h1><p>{initialProject.title}</p></header>
    <nav className="settings-nav" aria-label="设置分组" role="tablist">{sections.map(([id, label], index) => <button key={id} id={`settings-tab-${id}`} role="tab" aria-selected={section === id} aria-controls={`settings-${id}`} tabIndex={section === id ? 0 : -1} className={section === id ? 'active' : ''} onClick={() => changeSection(id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : -1
      if (next < 0) return
      event.preventDefault(); changeSection(sections[next][0]); globalThis.document.getElementById(`settings-tab-${sections[next][0]}`)?.focus()
    }}>{label}{id === 'project' && dirty ? <span className="settings-dirty-dot" aria-label="有未保存修改" /> : null}</button>)}</nav>
    {preferenceError ? <div role="alert" className="settings-preference-error"><span>{preferenceError}</span><Button variant="outline" onClick={() => { setPreferences({}); if (!useAppStore.getState().preferenceError) setTheme(theme) }}>重试保存偏好</Button></div> : null}
    <div className="settings-scroll" ref={scrollRef}>
      <section id="settings-project" role="tabpanel" aria-labelledby="settings-tab-project" hidden={section !== 'project'}>
        <Panel className="settings-card settings-project-card"><div className="settings-section-heading"><h2>作品信息</h2><span className="field-hint">修改后需保存</span></div><fieldset disabled={busy} className="settings-form">
          <Field label="作品名"><TextInput value={draft.title} onChange={event => updateDraft('title', event.target.value)} /></Field>
          <div className="field-grid"><Field label="作者"><TextInput value={draft.author} onChange={event => updateDraft('author', event.target.value)} /></Field><Field label="类型"><TextInput value={draft.genre} onChange={event => updateDraft('genre', event.target.value)} placeholder="如：悬疑、奇幻、都市" /></Field></div>
          <Field label="目标字数"><TextInput type="number" min="0" step="1" value={draft.targetWords} onChange={event => updateDraft('targetWords', event.target.value)} /></Field>
          <Field label="简介"><textarea className="text-area" value={draft.description} onChange={event => updateDraft('description', event.target.value)} placeholder="记录作品的核心设定与故事方向" /></Field>
        </fieldset><div className="settings-project-dates"><span>创建于 {new Date(initialProject.createdAt).toLocaleString('zh-CN')}</span><span>最后修改 {new Date(initialProject.updatedAt).toLocaleString('zh-CN')}</span></div></Panel>
      </section>
      <section id="settings-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={section !== 'appearance'}>
        <Panel className="settings-card">{heading('外观与布局', <Button variant="outline" onClick={() => { setTheme('system'); setPreferences({ sidebarWidth: defaults.sidebarWidth, inspectorWidth: defaults.inspectorWidth }) }}>恢复本页默认</Button>)}<h3>主题</h3>
          <div className="settings-theme-cards">{([{ id: 'light', label: '浅色', Icon: Sun }, { id: 'dark', label: '深色', Icon: Moon }, { id: 'system', label: '跟随系统', Icon: Monitor }] as const).map(({ id, label, Icon }) => <button key={id} className={theme === id ? 'active' : ''} aria-pressed={theme === id} onClick={() => setTheme(id as ThemeMode)}><span className={`settings-theme-sample ${id}`} aria-hidden="true"><i /><span><b /><b /><b /></span></span><span className="settings-theme-label"><Icon size={14} />{label}{theme === id ? <Check size={14} /> : null}</span></button>)}</div>
          <div className="settings-range-grid"><NumberSetting label="左侧栏宽度" value={preferences.sidebarWidth} min={220} max={420} unit="px" onChange={value => preference('sidebarWidth', value)} /><NumberSetting label="辅助栏宽度" value={preferences.inspectorWidth} min={220} max={420} unit="px" onChange={value => preference('inspectorWidth', value)} /></div>
          <div className="settings-layout-preview" style={{ gridTemplateColumns: `${preferences.sidebarWidth}fr 600fr ${preferences.inspectorWidth}fr` }} aria-label="侧栏宽度比例示意"><span>左栏<small>{preferences.sidebarWidth}px</small></span><span>正文工作区</span><span>辅助栏<small>{preferences.inspectorWidth}px</small></span></div><p className="field-hint">比例示意；实际宽度会根据窗口空间调整。</p>
        </Panel>
      </section>
      <section id="settings-editor" role="tabpanel" aria-labelledby="settings-tab-editor" hidden={section !== 'editor'}>
        <Panel className="settings-card">{heading('编辑器', <Button variant="outline" onClick={resetEditor}>恢复本页默认</Button>)}<div className="settings-editor-layout"><div className="settings-editor-controls">
          <Field label="正文字体"><select className="select-input" value={preferences.editorFontFamily} onChange={event => preference('editorFontFamily', event.target.value === 'sans' ? 'sans' : 'serif')}><option value="serif">衬线 · 适合长篇阅读</option><option value="sans">无衬线 · 适合校对</option></select></Field>
          <NumberSetting label="编辑字号" value={preferences.editorFontSize} min={12} max={22} unit="px" onChange={value => preference('editorFontSize', value)} />
          <NumberSetting label="行高" value={preferences.editorLineHeight} min={1.4} max={2.6} step={0.05} onChange={value => preference('editorLineHeight', value)} />
          <NumberSetting label="内容宽度" value={preferences.contentWidth} min={560} max={1200} step={10} unit="px" onChange={value => preference('contentWidth', value)} />
          <NumberSetting label="段落间距" value={preferences.paragraphSpacing} min={0} max={40} unit="px" onChange={value => preference('paragraphSpacing', value)} />
        </div><div className="settings-preview-column"><div className="settings-reading-preview" style={{ maxWidth: preferences.contentWidth, fontFamily: preferences.editorFontFamily === 'serif' ? 'Georgia, Noto Serif SC, serif' : 'system-ui, sans-serif', fontSize: preferences.editorFontSize, lineHeight: preferences.editorLineHeight }}><span>正文效果预览</span><h3>暮色中的来信</h3>{['暮色落在窗前，远处的灯光一盏盏亮起。她合上书，听见门外传来轻轻的脚步声。', '信封上没有署名，只有一行熟悉的字迹。她认得那个人的笔迹，可他们已经多年未见。', '故事从这里开始。调整字号、行高和段落间距，找到适合你的阅读节奏。'].map(text => <p key={text} style={{ marginBottom: preferences.paragraphSpacing }}>{text}</p>)}</div><p className="field-hint">预览随参数同步变化；正文宽度以当前可用空间为上限。</p></div></div></Panel>
      </section>
      <section id="settings-writing" role="tabpanel" aria-labelledby="settings-tab-writing" hidden={section !== 'writing'}>
        <Panel className="settings-card">{heading('每日写作目标', <Button variant="outline" onClick={() => preference('dailyTargetWords', defaults.dailyTargetWords)}>恢复每日目标默认</Button>)}<NumberSetting label="每日写作目标" value={preferences.dailyTargetWords} min={0} max={100000} step={100} unit="字" onChange={value => preference('dailyTargetWords', value)} /><p className="field-hint">仅调整每日目标，不影响作品总目标字数。</p></Panel><ChecklistTemplateSettings />
      </section>
      <section id="settings-data" role="tabpanel" aria-labelledby="settings-tab-data" hidden={section !== 'data'}>
        <Panel className="settings-card"><div className="settings-section-heading"><h2>项目数据</h2><HardDrive size={18} /></div><p className="field-hint">{isDesktop ? '文件保存在你选择的项目文件夹。' : '当前为浏览器开发模式，数据保存在本机浏览器中。'}</p><div className="settings-project-path"><code>{projectPath}</code><Button variant="outline" onClick={() => { void writeClipboardText(projectPath).then(ok => setCopyStatus(ok ? '路径已复制' : '复制失败，请手动复制路径')).catch(() => setCopyStatus('复制失败，请手动复制路径')) }}><Copy size={13} />复制路径</Button></div><span role="status" className="field-hint">{copyStatus}</span><div className="settings-info"><div><FileText size={16} /><span><strong>正文与资料保存在本地</strong>备份时请保留整个项目文件夹，包括正文、资料和历史记录。</span></div><div><ShieldCheck size={16} /><span><strong>AI 由你触发</strong>发送前可预览请求内容，选择本次使用的上下文。</span></div></div></Panel>
        <details className="settings-card settings-logs" onToggle={event => setLogsOpen(event.currentTarget.open)}><summary>应用日志<span>按需查看操作记录</span></summary>{section === 'data' && logsOpen ? <ProjectLogs projectPath={projectPath} /> : null}</details>
      </section>
    </div>
    {section === 'project' || dirty || saveError ? <footer className="settings-savebar"><div><span role="status">{busy ? '正在保存作品信息…' : dirty ? '作品信息有未保存修改' : '作品信息已保存'}</span>{saveError ? <p role="alert">保存失败：{saveError}</p> : null}</div><Button disabled={busy || !dirty} onClick={() => void submit()}><Save size={14} />{busy ? '保存中…' : '保存作品信息'}</Button></footer> : null}
  </div>
}