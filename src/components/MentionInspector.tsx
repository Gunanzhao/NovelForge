import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, ScanSearch, X } from 'lucide-react'
import { insertMentionWiki, scanMentions } from '../lib/mention-detection'
import type { MentionCandidate, MentionKind } from '../lib/mention-detection'
import type { EntityRecord } from '../lib/types'
import { useAppStore } from '../stores/app-store'
import { Button } from './ui'

const KIND_LABELS: Record<MentionKind, string> = {
  character: '人物',
  location: '地点',
  world: '世界观',
}

function permanentIgnoredTexts(entities: EntityRecord[]) {
  return entities
    .filter((entity) => entity.kind === 'mention-ignore')
    .map((entity) => typeof entity.content.text === 'string' ? entity.content.text : entity.title)
    .filter(Boolean)
}

export function MentionInspector() {
  const document = useAppStore((state) => state.document)
  const data = useAppStore((state) => state.data)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const updateContent = useAppStore((state) => state.updateContent)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const setError = useAppStore((state) => state.setError)
  const [ignoredOnce, setIgnoredOnce] = useState<Set<string>>(new Set())
  const [mentions, setMentions] = useState<MentionCandidate[]>([])
  const [scanVersion, setScanVersion] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const ignoredPermanent = useMemo(() => permanentIgnoredTexts(data?.entities ?? []), [data?.entities])

  useEffect(() => {
    setIgnoredOnce(new Set())
  }, [document?.node.id])

  useEffect(() => {
    if (!document || !data) {
      setMentions([])
      return
    }
    const timer = window.setTimeout(() => {
      setMentions(scanMentions(document.content, data.entities, [...ignoredPermanent, ...ignoredOnce]))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [data, document, ignoredOnce, ignoredPermanent, scanVersion])

  if (!document || !data || !projectPath) return null
  const currentDocument = document
  const currentProjectPath = projectPath
  const visible = mentions.filter((mention) => mention.status !== 'ignored')
  const known = visible.filter((mention) => mention.status === 'known')
  const candidates = visible.filter((mention) => mention.status === 'candidate')

  async function createMention(mention: MentionCandidate, insertWiki: boolean) {
    setBusyId(mention.id)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: mention.kind,
        id: null,
        title: mention.text,
        tags: ['自动识别'],
        content: {
          firstAppearance: currentDocument.node.id,
          firstAppearanceTitle: currentDocument.node.title,
        },
      })
      const latest = useAppStore.getState()
      if (insertWiki && latest.projectPath === currentProjectPath && latest.document?.node.id === currentDocument.node.id) {
        // Only replace a range that still contains the scanned text; never restore an old snapshot.
        updateContent(insertMentionWiki(latest.document.content, mention))
      }
      setScanVersion((version) => version + 1)
    } catch (error) {
      setError(error)
    } finally {
      setBusyId(null)
    }
  }

  async function ignorePermanently(mention: MentionCandidate) {
    setBusyId(mention.id)
    try {
      await saveEntity({
        projectPath: currentProjectPath,
        kind: 'mention-ignore',
        id: null,
        title: mention.text,
        tags: ['自动识别忽略'],
        content: { text: mention.text, kind: mention.kind },
      })
    } catch (error) {
      setError(error)
    } finally {
      setBusyId(null)
    }
  }

  return <div className="mention-inspector">
    <div className="panel-title">
      <h3><ScanSearch size={14} />本章识别</h3>
      <Button variant="ghost" onClick={() => setScanVersion((version) => version + 1)}><RefreshCw size={12} />重新扫描</Button>
    </div>
    <div className="mention-summary">{known.length} 个已识别 · {candidates.length} 个候选</div>
    {known.length ? <div className="mention-group"><strong>已识别资料</strong>{known.map((mention) => <button className="mention-row known" key={mention.id} onClick={() => mention.entityId && selectEntity(mention.kind, mention.entityId)}><span>{mention.text}</span><small>{KIND_LABELS[mention.kind]}</small></button>)}</div> : null}
    {candidates.length ? <div className="mention-group"><strong>可能的新资料</strong>{candidates.map((mention) => <div className="mention-candidate" key={mention.id}><div><span>{mention.text}</span><small>{KIND_LABELS[mention.kind]} · {Math.round(mention.confidence * 100)}%</small></div><div className="mention-actions"><Button variant="ghost" disabled={busyId === mention.id} onClick={() => void createMention(mention, false)}><Plus size={11} />创建</Button><Button variant="ghost" disabled={busyId === mention.id} onClick={() => void createMention(mention, true)}>创建并插入 Wiki</Button><Button variant="ghost" onClick={() => setIgnoredOnce((current) => new Set([...current, mention.text]))}><X size={11} />本次忽略</Button><Button variant="ghost" disabled={busyId === mention.id} onClick={() => void ignorePermanently(mention)}>永久忽略</Button></div></div>)}</div> : null}
    {!visible.length ? <span className="field-hint">当前正文中没有可显示的资料命中或规则候选。</span> : null}
  </div>
}
