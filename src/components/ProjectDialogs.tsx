import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, Copy, FolderOpen, Save } from 'lucide-react'
import { chooseDirectory, isDesktop } from '../lib/api'
import type { NodeKind, NodeRecord, ProjectData, ProjectInput } from '../lib/types'
import { Button, Field, Modal, TextInput } from './ui'
import { useAppStore } from '../stores/app-store'

export function ProjectDialog({ mode, onClose }: { mode: 'new' | 'open' | null; onClose: () => void }) {
  const createProject = useAppStore((state) => state.createProject)
  const openProject = useAppStore((state) => state.openProject)
  const [path, setPath] = useState('')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState('现代')
  const [targetWords, setTargetWords] = useState('300000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  useEffect(() => {
    setError('')
    if (mode === 'new') {
      setPath(isDesktop ? '' : 'browser-demo')
      setTitle('')
      setAuthor('')
      setDescription('')
      setGenre('现代')
      setTargetWords('300000')
    }
  }, [mode])

  async function pickPath() {
    try {
      const selected = await chooseDirectory(mode === 'new' ? '选择新项目的空文件夹' : '选择已有项目的文件夹')
      if (selected) { setPath(selected); setError('') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  async function submit() {
    if (!mode || !path.trim() || inFlight.current) return
    const generation = useAppStore.getState().projectSession
    inFlight.current = true
    setError('')
    setBusy(true)
    try {
      if (mode === 'new') {
        const input: ProjectInput = {
          path: path.trim(), title, author, description, genre,
          targetWords: Number.parseInt(targetWords, 10) || 300000,
        }
        await createProject(input)
      } else {
        await openProject(path.trim())
      }
      if (useAppStore.getState().projectSession !== generation) onClose()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(mode === 'open' && message.startsWith('这里没有找到 project.json')
        ? '这个文件夹没有找到 project.json。请选择 NovelForge 项目所在的文件夹。' : message)
      if (!message.startsWith('EXTERNAL_CONFLICT:') && useAppStore.getState().error === message) useAppStore.setState({ error: null })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <Modal open={mode !== null} title={mode === 'new' ? '创建小说项目' : '打开小说项目'} onClose={() => { if (!inFlight.current) onClose() }}
    footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button onClick={() => void submit()} disabled={busy || !path.trim()}><Save size={15} />{busy ? '处理中…' : mode === 'new' ? '创建并开始写作' : '打开项目'}</Button></>}>
    <div className="dialog-stack">
      <Field label="项目文件夹" hint={isDesktop ? mode === 'new' ? '请选择一个空文件夹保存正文和资料。' : '选择包含 project.json 的项目文件夹。备份文件请使用「从备份恢复」。' : '浏览器开发模式使用 localStorage；桌面版可选择真实文件夹。'}>
        <div className="input-with-action"><TextInput value={path} disabled={busy} aria-invalid={mode === 'open' && Boolean(error)} onChange={(event) => { setPath(event.target.value); setError('') }} placeholder={isDesktop ? '选择项目文件夹' : 'browser-demo'} /><Button variant="outline" disabled={busy} onClick={() => void pickPath()}><FolderOpen size={15} />选择</Button></div>
      </Field>
      {error && <p role="alert" className="settings-inline-error">{error}</p>}
      {mode === 'new' ? <><Field label="作品名"><TextInput autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雾港来信" /></Field>
        <div className="field-grid"><Field label="作者"><TextInput value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="署名" /></Field><Field label="类型"><TextInput value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="现代 / 仙侠 / 科幻" /></Field></div>
        <Field label="目标字数"><TextInput type="number" min="0" value={targetWords} onChange={(event) => setTargetWords(event.target.value)} /></Field>
        <Field label="简介"><textarea className="text-area compact" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话记录这部作品想写什么。" /></Field></> : null}
    </div>
  </Modal>
}

export function NodeDialog({ kind, parentId, onClose }: { kind: NodeKind | null; parentId: string | null; onClose: () => void }) {
  const createNode = useAppStore((state) => state.createNode)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  useEffect(() => setTitle(''), [kind, parentId])
  async function submit() {
    if (inFlight.current || !kind || !title.trim()) return
    inFlight.current = true
    setError('')
    setBusy(true)
    try { await createNode(kind, title.trim(), kind === 'volume' ? null : parentId); onClose() } catch (error) { setError(String(error)) } finally { inFlight.current = false; setBusy(false) }
  }
  const label = kind === 'volume' ? '卷' : kind === 'chapter' ? '章' : '节'
  return <Modal open={kind !== null} title={'新建' + label} onClose={() => { if (!inFlight.current) onClose() }}
    footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button onClick={() => void submit()} disabled={busy || !title.trim()}>{busy ? '创建中…' : '创建'}</Button></>}>
    {error ? <div role="alert">{error}</div> : null}
    <Field label={label + '标题'}><TextInput autoFocus disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit() }} placeholder={kind === 'volume' ? '第二卷' : kind === 'chapter' ? '第二章' : '开场' } /></Field>
  </Modal>
}

export function NodeTransferDialog({
  mode, node, data, onClose, onSubmit,
}: {
  mode: 'move' | 'copy' | null
  node: NodeRecord | null
  data: ProjectData | null
  onClose: () => void
  onSubmit: (targetParentId: string | null, title?: string) => Promise<void>
}) {
  const [targetParentId, setTargetParentId] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const targets = useMemo(() => data && node
    ? data.nodes.filter((candidate) => candidate.kind === (node.kind === 'chapter' ? 'volume' : node.kind === 'section' ? 'chapter' : 'volume'))
    : [], [data, node])

  useEffect(() => {
    if (!node || !data) {
      setTargetParentId('')
      setTitle('')
      return
    }
    const firstTarget = targets.find((candidate) => candidate.id !== node.parentId)
    setTargetParentId(firstTarget?.id ?? targets[0]?.id ?? '')
    setTitle(mode === 'copy' ? node.title + ' 副本' : node.title)
  }, [data, mode, node, targets])

  async function submit() {
    if (!node || !mode || (node.kind !== 'volume' && !targetParentId)) return
    setBusy(true)
    try {
      await onSubmit(node.kind === 'volume' ? null : targetParentId, mode === 'copy' ? title.trim() : undefined)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const targetLabel = node?.kind === 'chapter' ? '目标卷' : node?.kind === 'section' ? '目标章节' : '复制到项目根目录'
  return <Modal open={Boolean(mode && node)} title={mode === 'move' ? '移动正文节点' : '复制正文节点'} onClose={() => { if (!busy) onClose() }}
    footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button><Button onClick={() => void submit()} disabled={busy || !node || (node.kind !== 'volume' && !targetParentId) || (mode === 'copy' && !title.trim())}>{busy ? '处理中…' : mode === 'move' ? <><ArrowRightLeft size={14} />移动</> : <><Copy size={14} />复制</>}</Button></>}>
    <div className="dialog-stack">
      {node ? <div className="field-hint">当前节点：{node.title}</div> : null}
      {node?.kind === 'volume' ? <div className="field-hint">卷只能位于项目根目录；复制会在现有卷末尾创建一个完整副本。</div> : <Field label={targetLabel}><select className="select-input" value={targetParentId} onChange={(event) => setTargetParentId(event.target.value)}>{targets.map((target) => <option value={target.id} key={target.id}>{target.title}</option>)}</select></Field>}
      {mode === 'copy' ? <Field label="副本名称"><TextInput autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></Field> : null}
    </div>
  </Modal>
}
