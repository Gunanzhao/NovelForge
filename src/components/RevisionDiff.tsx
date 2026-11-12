import { useEffect, useMemo, useRef, useState } from 'react'
import { reviewBlocks, reviewDiff } from '../lib/review-diff'
import type { DiffLine } from '../lib/text-diff'
import { Button } from './ui'

function Lines({ lines }: { lines: DiffLine[] }) {
  const runs: { kind: DiffLine['kind']; text: string[] }[] = []
  for (const line of lines) {
    const previous = runs[runs.length - 1]
    const text = (line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  ') + line.text
    if (previous?.kind === line.kind) previous.text.push(text)
    else runs.push({ kind: line.kind, text: [text] })
  }
  return <>{runs.map((run, i) => <pre className={run.kind} key={i}>{run.text.join('\n')}</pre>)}</>
}
export function RevisionDiff({ original, candidate, latest = false, afterConfirmation = false }: { original: string; candidate: string | null; latest?: boolean; afterConfirmation?: boolean }) {
  const blocks = useMemo(() => candidate === null ? [] : reviewBlocks(reviewDiff(original, candidate)), [original, candidate])
  const changes = blocks.flatMap((block, index) => block.changed ? [index] : [])
  const [position, setPosition] = useState(-1)
  useEffect(() => setPosition(-1), [original, candidate])
  const refs = useRef(new Map<number, HTMLDivElement>())
  const originalTitle = afterConfirmation ? '本轮确认的正文' : latest ? '当前磁盘正文' : '审阅基准原文'
  const candidateTitle = afterConfirmation ? '当前磁盘正文' : '已保存改稿'
  function jump(direction: number) {
    if (!changes.length) return
    const next = position < 0 ? (direction > 0 ? 0 : changes.length - 1) : (position + direction + changes.length) % changes.length
    setPosition(next)
    const target = refs.current.get(changes[next])
    target?.scrollIntoView({ block: 'nearest' }); target?.focus({ preventScroll: true })
  }
  return <section className="revision-compare">
    <h3>{candidate === null ? originalTitle : `对比：${originalTitle} → ${candidateTitle}`}</h3>
    {candidate === null ? <pre className="revision-text" aria-label={originalTitle}>{original || '（空白正文）'}</pre> : <>
      {!changes.length ? <p className="field-hint">{candidate === original ? '改稿与原文相同，确认只记录审阅进度。' : '文本相同，换行格式有变化。'}</p> : <div className="revision-actions"><Button variant="outline" onClick={() => jump(-1)}>上一处差异</Button><Button variant="outline" onClick={() => jump(1)}>下一处差异</Button><span role="status">{position >= 0 ? Math.min(position + 1, changes.length) : 0} / {changes.length} 处差异</span></div>}
      <p className="revision-legend"><span className="removed">− {afterConfirmation ? '后续移除' : '原文移除'}</span><span className="added">+ {afterConfirmation ? '后续新增' : '改稿新增'}</span></p>
      <div className="revision-text revision-diff-blocks" aria-label={afterConfirmation ? '确认后的正文差异' : '改稿差异'}>
        {blocks.map((block, index) => block.changed ? <div tabIndex={-1} className="revision-diff-change" ref={element => { if (element) refs.current.set(index, element); else refs.current.delete(index) }} key={index}><Lines lines={block.lines} /></div> : block.lines.length > 8 ? <div key={index}><Lines lines={block.lines.slice(0, 3)} /><details><summary>展开 {block.lines.length - 6} 行未改正文</summary><Lines lines={block.lines.slice(3, -3)} /></details><Lines lines={block.lines.slice(-3)} /></div> : <Lines key={index} lines={block.lines} />)}
      </div>
    </>}
  </section>
}
