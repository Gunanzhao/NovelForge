import { useEffect, useState } from 'react'
import { FileText, HardDrive, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { isDesktop, projectApi } from '../lib/api'
import type { ThemeMode } from '../lib/types'
import type { WorkspacePreferences } from '../lib/workspace-preferences'
import { useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'
import { ChecklistTemplateSettings } from './ChapterWorkflow'

export function SettingsView() {
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const workspacePreferences = useAppStore((state) => state.workspacePreferences)
  const setWorkspacePreferences = useAppStore((state) => state.setWorkspacePreferences)
  const updateProject = useAppStore((state) => state.updateProject)
  const setError = useAppStore((state) => state.setError)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [genre, setGenre] = useState('')
  const [description, setDescription] = useState('')
  const [targetWords, setTargetWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState('')
  const [logsBusy, setLogsBusy] = useState(false)

  useEffect(() => {
    if (!data) return
    setTitle(data.project.title); setAuthor(data.project.author); setGenre(data.project.genre)
    setDescription(data.project.description); setTargetWords(String(data.project.targetWords))
  }, [data])

  useEffect(() => {
    let cancelled = false
    if (!projectPath) {
      setLogs('')
      return () => { cancelled = true }
    }
    setLogsBusy(true)
    void projectApi.readLogs(projectPath).then((value) => {
      if (!cancelled) setLogs(value)
    }).catch((error) => {
      if (!cancelled) setError(error)
    }).finally(() => {
      if (!cancelled) setLogsBusy(false)
    })
    return () => { cancelled = true }
  }, [projectPath, setError])

  if (!data || !projectPath) return null
  async function submit() {
    setBusy(true)
    try { await updateProject({ title, author, genre, description, targetWords: Number.parseInt(targetWords, 10) || 0 }) } finally { setBusy(false) }
  }

  function updatePreference<K extends keyof WorkspacePreferences>(key: K, value: WorkspacePreferences[K]) {
    setWorkspacePreferences({ [key]: value } as Partial<WorkspacePreferences>)
  }

  return <div className="settings-view">
    <div className="view-header" style={{ padding: 0, marginBottom: 18 }}><div><p className="eyebrow">PROJECT PREFERENCES</p><h1>项目设置</h1><p>编辑作品元数据和工作台偏好。核心正文不会被存进设置 JSON。</p></div></div>
    <Panel className="settings-card"><h3>作品信息</h3><div className="settings-form"><Field label="作品名"><TextInput value={title} onChange={(event) => setTitle(event.target.value)} /></Field><div className="field-grid"><Field label="作者"><TextInput value={author} onChange={(event) => setAuthor(event.target.value)} /><span className="field-hint">创建于 {data.project.createdAt}</span></Field><Field label="类型"><TextInput value={genre} onChange={(event) => setGenre(event.target.value)} /><span className="field-hint">最后修改 {data.project.updatedAt}</span></Field></div><Field label="目标字数"><TextInput type="number" min="0" value={targetWords} onChange={(event) => setTargetWords(event.target.value)} /></Field><Field label="简介"><textarea className="text-area compact" value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Button onClick={() => void submit()} disabled={busy}><Save size={14} />{busy ? '保存中…' : '保存项目信息'}</Button></div></Panel>
    <Panel className="settings-card"><h3>阅读与写作外观</h3><Field label="主题"><div className="theme-buttons">{(['light', 'dark', 'system'] as ThemeMode[]).map((item) => <Button key={item} variant="outline" className={theme === item ? 'active' : ''} onClick={() => setTheme(item)}>{item === 'light' ? '浅色' : item === 'dark' ? '深色' : '跟随系统'}</Button>)}</div></Field><div className="settings-range-grid"><label className="range-field"><span>左侧栏宽度 <output>{workspacePreferences.sidebarWidth}px</output></span><input type="range" min="220" max="420" value={workspacePreferences.sidebarWidth} onChange={(event) => updatePreference('sidebarWidth', Number(event.target.value))} /></label><label className="range-field"><span>辅助栏宽度 <output>{workspacePreferences.inspectorWidth}px</output></span><input type="range" min="220" max="420" value={workspacePreferences.inspectorWidth} onChange={(event) => updatePreference('inspectorWidth', Number(event.target.value))} /></label><label className="range-field"><span>编辑字号 <output>{workspacePreferences.editorFontSize}px</output></span><input type="range" min="12" max="22" value={workspacePreferences.editorFontSize} onChange={(event) => updatePreference('editorFontSize', Number(event.target.value))} /></label><label className="range-field"><span>行高 <output>{workspacePreferences.editorLineHeight}</output></span><input type="range" min="1.4" max="2.6" step="0.05" value={workspacePreferences.editorLineHeight} onChange={(event) => updatePreference('editorLineHeight', Number(event.target.value))} /></label><label className="range-field"><span>内容宽度 <output>{workspacePreferences.contentWidth}px</output></span><input type="range" min="560" max="1200" step="10" value={workspacePreferences.contentWidth} onChange={(event) => updatePreference('contentWidth', Number(event.target.value))} /></label><label className="range-field"><span>段落间距 <output>{workspacePreferences.paragraphSpacing}px</output></span><input type="range" min="0" max="40" value={workspacePreferences.paragraphSpacing} onChange={(event) => updatePreference('paragraphSpacing', Number(event.target.value))} /></label><label className="range-field"><span>每日写作目标 <output>{workspacePreferences.dailyTargetWords} 字</output></span><input type="range" min="0" max="10000" step="100" value={workspacePreferences.dailyTargetWords} onChange={(event) => updatePreference('dailyTargetWords', Number(event.target.value))} /></label></div><Field label="正文衬线字体"><select className="select-input" value={workspacePreferences.editorFontFamily} onChange={(event) => updatePreference('editorFontFamily', event.target.value === 'sans' ? 'sans' : 'serif')}><option value="serif">衬线（适合长篇阅读）</option><option value="sans">无衬线（适合校对）</option></select></Field></Panel>
    <ChecklistTemplateSettings /><Panel className="settings-card"><h3>数据与隐私</h3><div className="settings-info"><div><HardDrive size={15} /><span><strong>本地项目</strong>{isDesktop ? '文件保存在你选择的项目文件夹。' : '当前为浏览器开发模式，数据暂存 localStorage。'}<small className="path-text">{projectPath}</small></span></div><div><ShieldCheck size={15} /><span><strong>AI 默认关闭</strong>没有 API Key 时不会发送任何正文；Provider Key 只在当前窗口内使用。</span></div></div></Panel>
    <Panel className="settings-card"><div className="panel-title"><h3>应用日志</h3><Button variant="outline" onClick={() => { setLogsBusy(true); void projectApi.readLogs(projectPath).then(setLogs).catch(setError).finally(() => setLogsBusy(false)) }} disabled={logsBusy}><RefreshCw size={13} className={logsBusy ? 'spin' : ''} />{logsBusy ? '读取中…' : '刷新日志'}</Button></div><div className="settings-info"><div><FileText size={15} /><span><strong>操作级日志</strong>仅记录项目打开、保存、导出等事件；不会记录完整正文、API Key 或其他隐私内容。</span></div></div><pre className="settings-log">{logs || '暂无日志记录。'}</pre></Panel>
  </div>
}
