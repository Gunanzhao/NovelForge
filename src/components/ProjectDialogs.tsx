import { useEffect, useState } from 'react'
import { FolderOpen, Save } from 'lucide-react'
import { chooseDirectory, isDesktop } from '../lib/api'
import type { NodeKind, ProjectInput } from '../lib/types'
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

  useEffect(() => {
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
    const selected = await chooseDirectory()
    if (selected) setPath(selected)
  }

  async function submit() {
    if (!path.trim()) return
    setBusy(true)
    try {
      if (mode === 'new') {
        const input: ProjectInput = {
          path, title, author, description, genre,
          targetWords: Number.parseInt(targetWords, 10) || 300000,
        }
        await createProject(input)
      } else {
        await openProject(path)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return <Modal open={mode !== null} title={mode === 'new' ? '创建小说项目' : '打开小说项目'} onClose={onClose}
    footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={() => void submit()} disabled={busy || !path.trim()}><Save size={15} />{busy ? '处理中…' : mode === 'new' ? '创建并开始写作' : '打开项目'}</Button></>}>
    <div className="dialog-stack">
      <Field label="项目文件夹" hint={isDesktop ? '正文和资料会保存在这个文件夹内。' : '浏览器开发模式使用 localStorage；桌面版可选择真实文件夹。'}>
        <div className="input-with-action"><TextInput value={path} onChange={(event) => setPath(event.target.value)} placeholder={isDesktop ? '选择项目文件夹' : 'browser-demo'} /><Button variant="outline" onClick={() => void pickPath()}><FolderOpen size={15} />选择</Button></div>
      </Field>
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
  useEffect(() => setTitle(''), [kind, parentId])
  async function submit() {
    if (!kind || !title.trim()) return
    setBusy(true)
    try { await createNode(kind, title.trim(), kind === 'volume' ? null : parentId); onClose() } finally { setBusy(false) }
  }
  const label = kind === 'volume' ? '卷' : kind === 'chapter' ? '章' : '节'
  return <Modal open={kind !== null} title={'新建' + label} onClose={onClose}
    footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={() => void submit()} disabled={busy || !title.trim()}>{busy ? '创建中…' : '创建'}</Button></>}>
    <Field label={label + '标题'}><TextInput autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit() }} placeholder={kind === 'volume' ? '第二卷' : kind === 'chapter' ? '第二章' : '开场' } /></Field>
  </Modal>
}
