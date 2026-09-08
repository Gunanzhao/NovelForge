import { useAiTask } from '../stores/ai-task'
import { useAppStore } from '../stores/app-store'
import { Button } from './ui'

export function AiReview() {
  const task = useAiTask()
  const current = useAppStore(state => state.document?.node.id)
  const pending = task.edits.filter(edit => edit.state === 'pending')
  const targetCurrent = current === task.target?.node
  return <div className="ai-review" aria-label="AI 修改对比">
    <div className="ai-review-summary"><span>{pending.length} 项待处理 · {task.edits.filter(edit => edit.state === 'accepted').length} 项已接受</span><Button variant="outline" disabled={!targetCurrent || !pending.length || pending.some(edit => edit.conflict)} onClick={() => task.accept()}>全部接受</Button></div>
    {!task.edits.length ? <p className="field-hint">生成结果与原文相同。</p> : task.edits.map((edit, index) => <section key={edit.id} className={'ai-review-edit is-' + (edit.conflict ? 'conflict' : edit.state)}>
      <header><strong>改动 {index + 1}</strong><span>{edit.state === 'accepted' ? '已接受' : edit.state === 'rejected' ? '已保留原文' : edit.conflict ? '原文已修改' : '待处理'}</span></header>
      <div className="ai-review-before"><small>原文</small><del>{edit.before || '（此处插入）'}</del></div>
      <div className="ai-review-after"><small>建议</small><ins>{edit.after || '（删除此处）'}</ins></div>
      {edit.state === 'pending' ? <footer><Button variant="ghost" onClick={() => task.reject(edit.id)}>保留原文</Button><Button disabled={!targetCurrent || edit.conflict} onClick={() => task.accept(edit.id)}>接受此项</Button></footer> : null}
      {edit.conflict && edit.state === 'pending' ? <p>该处正文已变化，可保留你的修改或重新生成。</p> : null}
    </section>)}
  </div>
}
