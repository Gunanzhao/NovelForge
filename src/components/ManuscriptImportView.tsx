import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../lib/api'
import { decodeManuscript, detectImportBoundaries, splitManuscript, validateImportChapters, MAX_IMPORT_BYTES, type ImportBoundary, type ImportedChapter, type ImportEncoding } from '../lib/manuscript-import'
import { useUnsavedDraft } from '../hooks/useUnsavedDraft'
import { markDraftSaved, setDraftSaving } from '../lib/draft-guard'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { isNodeLocked } from '../lib/node-lock'
import { Button, Field, TextInput } from './ui'

export function ManuscriptImportView() {
  const identity = useAppStore(state => state.projectPath + ':' + state.projectSession)
  return <ImportWorkspace key={identity} />
}
function ImportWorkspace() {
  const data = useAppStore(state => state.data), projectPath = useAppStore(state => state.projectPath)
  const [bytes, setBytes] = useState<Uint8Array | null>(null), [filename, setFilename] = useState('')
  const [encoding, setEncoding] = useState<ImportEncoding>('auto'), [decodedAs, setDecodedAs] = useState('')
  const [text, setText] = useState(''), [boundaries, setBoundaries] = useState<ImportBoundary[]>([]), [chosen, setChosen] = useState<number[]>([])
  const [chapters, setChapters] = useState<ImportedChapter[] | null>(null), [selected, setSelected] = useState(0)
  const [parentId, setParentId] = useState(data?.nodes.find(node => node.kind === 'volume' && !isNodeLocked(data.nodes, node.id))?.id ?? '')
  const [manualLine, setManualLine] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const pending = useRef(false), mounted = useRef(true), retry = useRef({ signature: '', id: '' }), fileInput = useRef<HTMLInputElement>(null)
  const draftId = 'manuscript-import:' + projectPath
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function clear() { setBytes(null); setFilename(''); setText(''); setBoundaries([]); setChosen([]); setChapters(null); setConfirmed(false); setError(''); setManualLine(''); retry.current = { signature: '', id: '' }; if (fileInput.current) fileInput.current.value = ''; markDraftSaved(draftId) }
  useUnsavedDraft(draftId, '稿件导入预览', Boolean(bytes), async () => { setError('请返回稿件导入页核对预览，勾选确认后创建章节。'); return false }, clear)
  function decode(value: Uint8Array, selectedEncoding: ImportEncoding) {
    setText(''); setBoundaries([]); setChosen([]); setChapters(null); setConfirmed(false); setError(''); setNotice('')
    try { const result = decodeManuscript(value, selectedEncoding); const found = detectImportBoundaries(result.text); setText(result.text); setDecodedAs(result.encoding); setBoundaries(found); setChosen(found.map(item => item.offset)) }
    catch (error) { setError(String(error)) }
  }
  async function readFile(file: File | undefined) {
    if (!file || pending.current || bytes) return
    if (!/\.(?:txt|md|markdown)$/iu.test(file.name)) { setError('请选择TXT或Markdown文件。'); return }
    if (file.size > MAX_IMPORT_BYTES) { setError('单次导入文件不能超过32 MiB。'); return }
    const session = captureProjectSession()
    pending.current = true; setBusy(true); setDraftSaving(draftId, true); setError('')
    try {
      const value = new Uint8Array(await file.arrayBuffer())
      if (!mounted.current || !isCurrentProjectSession(session)) return
      setBytes(value); setFilename(file.name); decode(value, encoding)
    } catch (error) { if (mounted.current && isCurrentProjectSession(session)) setError(String(error)) }
    finally { pending.current = false; setDraftSaving(draftId, false); if (mounted.current) setBusy(false) }
  }
  function addBoundary() {
    const line = Number(manualLine), lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? []
    if (!Number.isInteger(line) || line < 1 || line > lines.length) { setError('请输入原稿中有效的行号。'); return }
    const offset = lines.slice(0, line - 1).join('').length
    if (!boundaries.some(item => item.offset === offset)) setBoundaries([...boundaries, { offset, line, title: lines[line - 1].trim().slice(0, 200) || '新章节' }].sort((a, b) => a.offset - b.offset))
    setChosen([...new Set([...chosen, offset])]); setError('')
  }
  function preview() {
    try { setChapters(splitManuscript(text, boundaries.filter(item => chosen.includes(item.offset)), filename.replace(/\.[^.]+$/u, ''))); setSelected(0); setError(''); setConfirmed(false) }
    catch (error) { setError(String(error)) }
  }
  async function submit() {
    if (pending.current || !chapters || !projectPath || !data || !confirmed) return
    const session = captureProjectSession()
    pending.current = true; setBusy(true); setDraftSaving(draftId, true); setError(''); setNotice('')
    let committed = false
    try {
      const parent = data.nodes.find(node => node.id === parentId && node.kind === 'volume')
      if (!parent || isNodeLocked(data.nodes, parent.id)) throw new Error('请选择未锁定的目标卷。')
      validateImportChapters(chapters, data.nodes.filter(node => node.parentId === parentId).map(node => node.title))
      const signature = JSON.stringify({ projectPath, parentId, chapters })
      if (retry.current.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }
      const result = await projectApi.importManuscript({ projectPath, parentId, chapters, requestId: retry.current.id })
      committed = true
      if (!mounted.current || !isCurrentProjectSession(session)) return
      const count = chapters.length
      clear()
      await useAppStore.getState().refreshData(result, true, session)
      if (mounted.current && isCurrentProjectSession(session)) setNotice('已导入' + count + '个章节，可在正文目录中打开、编辑和搜索。原稿文件未改动。')
    } catch (error) { if (mounted.current && isCurrentProjectSession(session)) setError(committed ? '章节已导入，但界面刷新失败。请重新打开项目查看，勿重复导入。' : String(error)) }
    finally { pending.current = false; setDraftSaving(draftId, false); if (mounted.current) setBusy(false) }
  }
  if (!data || !projectPath) return null
  const current = chapters?.[selected]
  function editChapter(field: keyof ImportedChapter, value: string) { if (!chapters) return; setChapters(chapters.map((chapter, index) => index === selected ? { ...chapter, [field]: value } : chapter)); setConfirmed(false) }
  return <div className="workspace-view manuscript-import-view"><div className="archive-editor-detail">
    <div className="view-header"><div><p className="eyebrow">MANUSCRIPT IMPORT</p><h1>稿件导入</h1><p>选择TXT或Markdown原稿，核对分章后批量创建新章节。</p></div></div>
    <fieldset disabled={busy} className="import-controls">
      <Field label="原稿文件" hint="支持.txt、.md、.markdown，最大32 MiB；保留原稿文件。"><input ref={fileInput} type="file" accept=".txt,.md,.markdown" disabled={Boolean(bytes) || busy} onChange={event => void readFile(event.target.files?.[0])} /></Field>
      {bytes && <p>{filename} · {bytes.length.toLocaleString()}字节 <Button variant="ghost" onClick={clear}>放弃本次预览</Button></p>}
      {!chapters && <>
        <Field label="文件编码" hint="自动识别BOM，否则严格按UTF-8读取；旧编码文件可手动选择GB18030。"><select className="select-input" value={encoding} onChange={event => { const value = event.target.value as ImportEncoding; setEncoding(value); if (bytes) decode(bytes, value) }}><option value="auto">自动识别</option><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="gb18030">GB18030 / GBK</option></select></Field>
        {text && <><p>已按{decodedAs}解码；识别到{boundaries.length}处分章候选。取消勾选会合并到前一段，开篇文字会保留。</p>
          <div className="import-boundaries">{boundaries.map(item => <label key={item.offset}><input type="checkbox" checked={chosen.includes(item.offset)} onChange={event => setChosen(event.target.checked ? [...chosen, item.offset] : chosen.filter(offset => offset !== item.offset))} /><span>第{item.line}行 · {item.title}</span></label>)}</div>
          <div className="import-manual-boundary"><Field label="手动分章行号"><TextInput type="number" min="1" value={manualLine} onChange={event => setManualLine(event.target.value)} /></Field><Button variant="outline" onClick={addBoundary}>添加分章位置</Button></div>
          <details><summary>查看完整原稿</summary><textarea className="text-area import-source" readOnly aria-label="导入原稿" value={text} /></details>
          <Button onClick={preview}>生成分章预览</Button></>}
      </>}
      {chapters && <>
        <p>共{chapters.length}个章节。可逐章修改名称和正文；本次只创建新章节。</p>
        <Field label="目标卷"><select className="select-input" value={parentId} onChange={event => { setParentId(event.target.value); setConfirmed(false) }}><option value="">请选择目标卷</option>{data.nodes.filter(node => node.kind === 'volume').map(node => <option key={node.id} value={node.id} disabled={isNodeLocked(data.nodes, node.id)}>{node.title}{isNodeLocked(data.nodes, node.id) ? '（已锁定）' : ''}</option>)}</select></Field>
        <Field label="预览章节"><select className="select-input" value={selected} onChange={event => setSelected(Number(event.target.value))}>{chapters.map((chapter, index) => <option key={index} value={index}>{index + 1}. {chapter.title || '未命名'}</option>)}</select></Field>
        {current && <><Field label="导入章节名称"><TextInput value={current.title} onChange={event => editChapter('title', event.target.value)} /></Field><Field label="导入章节正文"><textarea className="text-area import-source" value={current.content} onChange={event => editChapter('content', event.target.value)} /></Field></>}
        <label className="import-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>我已核对编码、分章、内容和目标卷，确认创建这些章节。</span></label>
        <div className="entity-actions"><Button disabled={!confirmed || !parentId || busy} onClick={() => void submit()}>{busy ? '正在导入…' : '确认导入'}</Button><Button variant="outline" onClick={() => { setChapters(null); setConfirmed(false); setError('') }}>返回分章（放弃预览编辑）</Button></div>
      </>}
    </fieldset>
    {busy && <p role="status">正在处理稿件，请稍候…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div></div>
}
