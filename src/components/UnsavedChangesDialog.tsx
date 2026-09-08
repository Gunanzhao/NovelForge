import { decideDraftNavigation, dirtyDrafts, useDraftGuard } from '../lib/draft-guard'
import { Button, Modal } from './ui'
export function UnsavedChangesDialog() {
  const state = useDraftGuard()
  return <Modal open={state.open} title="有未保存的修改" onClose={() => { if (!state.busy) void decideDraftNavigation('cancel') }} footer={<><Button variant="outline" disabled={state.busy} onClick={() => void decideDraftNavigation('cancel')}>继续编辑</Button><Button variant="ghost" disabled={state.busy} onClick={() => void decideDraftNavigation('discard')}>放弃修改并离开</Button><Button disabled={state.busy} onClick={() => void decideDraftNavigation('save')}>{state.busy ? '正在保存…' : '保存后离开'}</Button></>}><p>离开前请处理：{dirtyDrafts().map(draft => draft.label).join('、')}。</p>{state.error ? <p role="alert">{state.error}</p> : null}</Modal>
}