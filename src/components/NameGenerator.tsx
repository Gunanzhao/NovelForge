import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Heart, Lock, Plus, Trash2, Wand2 } from 'lucide-react'
import { categoryEntityKind, generateNames, NAME_CATEGORIES, NAME_CATEGORY_LABELS, NAME_STYLES, readFavoriteNames, toggleFavoriteName, writeFavoriteNames } from '../lib/name-generator'
import type { FavoriteName, NameCategory, NameStyle } from '../lib/name-generator'
import { splitNameWords, type NameRules } from '../lib/name-rules'
import { nameKey, readNameWorkspace, writeNameWorkspace, type NameCandidate, type NameWorkspace } from '../lib/name-workspace'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { writeClipboardText } from '../lib/clipboard'
import { Button, Field, IconButton, Modal, TextInput } from './ui'
import { NameAiPanel } from './NameAiPanel'

export function NameGenerator() {
  const projectPath = useAppStore(state => state.projectPath) ?? ''
  return <NameGeneratorWorkspace key={projectPath} projectPath={projectPath} />
}
function NameGeneratorWorkspace({ projectPath }: { projectPath: string }) {
  const data = useAppStore(state => state.data)
  const [open, setOpen] = useState(false)
  const entryRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'generate' | 'favorites' | 'history' | 'settings'>('generate')
  const [category, setCategory] = useState<NameCategory>('character')
  const [style, setStyle] = useState<NameStyle>('中文现代')
  const [count, setCount] = useState('6')
  const [rules, setRules] = useState<NameRules>({ series: 'none' })
  const [items, setItems] = useState<NameCandidate[]>([])
  const [locked, setLocked] = useState<string[]>([])
  const [favorites, setFavorites] = useState<FavoriteName[]>(readFavoriteNames)
  const [workspace, setWorkspace] = useState(() => readNameWorkspace(projectPath))
  const [search, setSearch] = useState('')
  const [presetTitle, setPresetTitle] = useState('')
  const [avoidExisting, setAvoidExisting] = useState(true)
  const [avoidHistory, setAvoidHistory] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current?.querySelector<HTMLElement>('[role="dialog"]')
    dialog?.querySelector<HTMLElement>('select, input, button')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary') ?? []).filter(element => !element.closest('details:not([open])') || element.tagName === 'SUMMARY')
        const first = controls[0]; const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    const entry = entryRef.current
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true); entry?.focus() }
  }, [open])
  function persist(next: NameWorkspace) {
    setWorkspace(next)
    try { writeNameWorkspace(projectPath, next) } catch { setMessage('本地存储空间不足，本次改动仅在当前窗口保留。') }
  }
  function favorite(item: NameCandidate) {
    const next = toggleFavoriteName(favorites, { name: item.name, category: item.category, style: item.style, explanation: item.explanation, createdAt: new Date().toISOString() })
    setFavorites(next); writeFavoriteNames(next)
  }
  async function copy(text: string) {
    try { setMessage(await writeClipboardText(text) ? '已复制。' : '无法访问剪贴板，请手动选择名字复制。') } catch { setMessage('复制失败，请手动选择名字复制。') }
  }
  function existing(name: string) { return data?.entities.filter(entity => nameKey(entity.title) === nameKey(name)) ?? [] }
  function acceptBatch(next: NameCandidate[]) {
    setItems(next)
    if (next.length) persist({ ...workspace, history: [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), items: next }, ...workspace.history].slice(0, 50) })
  }
  function generate() {
    const requested = Math.min(30, Math.max(1, Math.round(Number(count) || 6)))
    const kept = items.filter(item => locked.includes(item.name))
    if (kept.length >= requested) { setMessage('已锁定的名字达到生成数量，请解锁部分名字或增加数量。'); return }
    const names = generateNames(category, requested - kept.length, style, {
      ...rules, surnames: workspace.surnames, roots: workspace.roots, banned: workspace.banned,
      previousNames: [...items.map(item => item.name), ...(avoidHistory ? workspace.history.flatMap(batch => batch.items.map(item => item.name)) : [])],
      avoidNames: avoidExisting ? data?.entities.map(entity => entity.title) : [],
    })
    setMessage(names.length + kept.length < requested ? `找到 ${names.length} 个新名字，部分条件或去重规则限制了候选数量。可以放宽条件或调整词库。` : '已生成，锁定的名字已保留。')
    acceptBatch([...kept, ...names.map(name => ({ name, category, style }))])
  }
  async function create(item: NameCandidate) {
    if (!projectPath || busy) return
    if (existing(item.name).length && !window.confirm(`项目中已有“${item.name}”，仍要新建同名资料吗？`)) return
    const session = captureProjectSession()
    setBusy(true)
    try {
      const kind = categoryEntityKind(item.category)
      await useAppStore.getState().saveEntity({ projectPath, kind, id: null, title: item.name, content: { summary: item.explanation || '由 NovelForge 本地规则生成，可继续编辑。', category: NAME_CATEGORY_LABELS[item.category], style: item.style }, tags: ['待完善', NAME_CATEGORY_LABELS[item.category]] })
      if (isCurrentProjectSession(session)) { useAppStore.getState().selectEntity(kind); setOpen(false) }
    } catch (error) { if (isCurrentProjectSession(session)) setMessage(String(error)) } finally { setBusy(false) }
  }
  function renderItems(list: NameCandidate[], lockable = false) {
    return <div className="name-suggestions">{list.map((item, index) => {
      const saved = favorites.some(value => value.name === item.name && value.category === item.category && value.style === item.style)
      const matches = existing(item.name)
      return <div className="name-suggestion" key={`${item.name}-${index}`}><span><strong>{item.name}</strong><small>{NAME_CATEGORY_LABELS[item.category]} · {item.style}{matches.length ? ` · 已有 ${matches.length} 个同名条目` : ''}</small>{item.explanation ? <small>{item.explanation}</small> : null}</span><span>
        {lockable ? <IconButton icon={Lock} label={(locked.includes(item.name) ? '解锁' : '锁定') + item.name} className={locked.includes(item.name) ? 'active' : ''} onClick={() => setLocked(current => current.includes(item.name) ? current.filter(name => name !== item.name) : [...current, item.name])} /> : null}
        <IconButton icon={Copy} label={'复制' + item.name} onClick={() => void copy(item.name)} /><IconButton icon={Heart} label={(saved ? '取消收藏' : '收藏') + item.name} className={saved ? 'active' : ''} onClick={() => favorite(item)} /><button className="name-create" disabled={busy || !projectPath} onClick={() => void create(item)}><Plus size={11} />建档</button>
      </span></div>
    })}</div>
  }
  const textRule = (key: 'surname' | 'required' | 'excluded' | 'suffix' | 'shared', label: string) => <Field label={label}><TextInput maxLength={40} value={rules[key] ?? ''} onChange={event => setRules({ ...rules, [key]: event.target.value })} /></Field>
  return <>
    <button ref={entryRef} type="button" className="name-generator-entry" onClick={() => setOpen(true)} aria-haspopup="dialog"><Wand2 size={16} /><span>名字生成器</span><span>打开</span></button>
    {createPortal(<div ref={dialogRef} className="name-generator-dialog"><Modal open={open} title="名字生成器" onClose={() => setOpen(false)}><div className="name-generator">
      <div className="name-tabs" role="tablist" aria-label="名字工具">{([['generate', '生成名字'], ['favorites', '收藏夹'], ['history', '最近生成'], ['settings', '词库与预设']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setMessage('') }}>{label}</button>)}</div>
      {message ? <p className="field-hint" role="status">{message}</p> : null}
      {tab === 'generate' ? <>
        <div className="name-generator-controls"><select className="select-input" value={category} onChange={event => { setCategory(event.target.value as NameCategory); setLocked([]); setRules(current => ({ ...current, surname: '', suffix: '', series: 'none' })) }} aria-label="名字类型">{NAME_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select className="select-input" value={style} onChange={event => { setStyle(event.target.value as NameStyle); setLocked([]) }} aria-label="名字风格">{NAME_STYLES.map(item => <option key={item}>{item}</option>)}</select><TextInput type="number" min="1" max="30" value={count} onChange={event => setCount(event.target.value)} aria-label="生成数量" /><Button variant="outline" onClick={generate}>生成</Button></div>
        <details className="name-options"><summary>更多条件</summary><div className="field-grid">{category === 'character' ? textRule('surname', '指定姓氏') : textRule('suffix', '指定后缀')}<Field label="名字总字数（含姓氏，留空不限）"><TextInput type="number" min="1" max="60" value={rules.length ?? ''} onChange={event => setRules({ ...rules, length: Number(event.target.value) || undefined })} /></Field>{textRule('required', '必含文字')}{textRule('excluded', '排除字')}<Field label="系列命名"><select className="select-input" value={rules.series ?? 'none'} onChange={event => setRules({ ...rules, series: event.target.value as NameRules['series'] })}><option value="none">独立命名</option>{category === 'character' ? <option value="family">同一家族</option> : null}<option value="shared">统一主题</option></select></Field>{textRule('shared', category === 'character' ? '辈分字 / 共同文字' : '系列共同前缀')}</div><p className="field-hint">英文空格也计入总字数。家族模式可指定姓氏；词库与预设页可设置小说专属用字。</p></details>
        <div className="name-checks"><label><input type="checkbox" checked={avoidExisting} onChange={event => setAvoidExisting(event.target.checked)} />避开项目已有名字</label><label><input type="checkbox" checked={avoidHistory} onChange={event => setAvoidHistory(event.target.checked)} />避开最近生成</label></div>
        {items.length ? renderItems(items, true) : <p className="field-hint">本地规则生成，无需 API Key。设置条件后生成，可锁定喜欢的名字再刷新其余结果。</p>}
        <div className="name-generator-footer"><Button variant="ghost" onClick={generate}>重新生成</Button><Button variant="ghost" disabled={!items.length} onClick={() => void copy(items.map(item => item.name).join('\n'))}>复制全部</Button><span>已锁定 {locked.length} 个</span></div>
        <NameAiPanel key={JSON.stringify([category, style, count, rules, locked, items, workspace.surnames, workspace.roots, workspace.banned, avoidExisting, avoidHistory])} category={category} style={style} count={Math.max(0, Math.min(30, Math.round(Number(count) || 6)) - locked.length)} rules={{ ...rules, surnames: workspace.surnames, roots: workspace.roots, banned: workspace.banned }} excluded={[...items.map(item => item.name), ...(avoidExisting ? data?.entities.map(entity => entity.title) ?? [] : []), ...(avoidHistory ? workspace.history.flatMap(batch => batch.items.map(item => item.name)) : [])]} onResults={next => { acceptBatch([...items.filter(item => locked.includes(item.name)), ...next]); setMessage(`已接收 ${next.length} 个 AI 名字，解释为创作联想。`) }} />
      </> : null}
      {tab === 'favorites' ? <><TextInput aria-label="搜索收藏" placeholder="搜索名字、类型或风格" value={search} onChange={event => setSearch(event.target.value)} /><p className="field-hint">跨项目收藏，最多 100 个。点击爱心可移除单个收藏。</p>{renderItems(favorites.filter(item => `${item.name} ${NAME_CATEGORY_LABELS[item.category]} ${item.style}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())))}{!favorites.length ? <p className="field-hint">尚未收藏名字。</p> : <Button variant="ghost" onClick={() => { if (window.confirm('清空全部名字收藏？')) { setFavorites([]); writeFavoriteNames([]) } }}><Trash2 size={12} />清空收藏</Button>}</> : null}
      {tab === 'history' ? <><p className="field-hint">保留本项目最近 50 批结果。</p>{workspace.history.map(batch => <div className="name-history" key={batch.id}><div className="panel-title"><span>{new Date(batch.createdAt).toLocaleString()} · {batch.items.length} 个</span><Button variant="ghost" onClick={() => { setItems(batch.items); setLocked([]); setTab('generate') }}>恢复结果</Button></div>{renderItems(batch.items)}</div>)}{!workspace.history.length ? <p className="field-hint">尚无生成记录。</p> : <Button variant="ghost" onClick={() => { if (window.confirm('清空本项目名字生成历史？')) persist({ ...workspace, history: [] }) }}>清空历史</Button>}</> : null}
      {tab === 'settings' ? <><p className="field-hint">词库与预设仅用于当前小说，保存在本机。词库以空格或逗号分隔，每项最多 80 个词；留空使用内置词库。</p>{(['surnames', 'roots', 'banned'] as const).map(key => <Field key={key} label={{ surnames: '专属姓氏', roots: '专属词根', banned: '禁用词' }[key]}><textarea className="text-area compact" defaultValue={workspace[key].join(' ')} onBlur={event => { const next = splitNameWords(event.target.value).slice(0, 80).map(word => word.slice(0, 40)); persist({ ...workspace, [key]: next }); event.target.value = next.join(' ') }} /></Field>)}<div className="name-preset-save"><TextInput aria-label="预设名称" placeholder="例如：林氏家族 / 北境城镇" maxLength={80} value={presetTitle} onChange={event => setPresetTitle(event.target.value)} /><Button disabled={!presetTitle.trim()} onClick={() => { persist({ ...workspace, presets: [{ id: crypto.randomUUID(), title: presetTitle.trim(), category, style, rules }, ...workspace.presets].slice(0, 20) }); setPresetTitle(''); setMessage('已保存当前类型、风格和更多条件。') }}>保存当前条件</Button></div>{workspace.presets.map(preset => <div className="name-preset-save" key={preset.id}><span>{preset.title}</span><Button variant="outline" onClick={() => { setCategory(preset.category); setStyle(preset.style); setRules(preset.rules); setLocked([]); setTab('generate') }}>应用</Button><IconButton icon={Trash2} label={'删除预设' + preset.title} onClick={() => persist({ ...workspace, presets: workspace.presets.filter(value => value.id !== preset.id) })} /></div>)}</> : null}
    </div></Modal></div>, document.body)}
  </>
}
