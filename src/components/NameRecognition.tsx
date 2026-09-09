import { useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { AutoNameMatch } from '../lib/auto-names'
import { nameKey } from '../lib/auto-names'
import { isNodeLocked } from '../lib/node-lock'
import { useAppStore } from '../stores/app-store'
import { ENTITY_LABELS } from '../lib/types'
import { Button, Modal } from './ui'
export interface NameCard extends AutoNameMatch { view: EditorView; version: EditorView['state']['doc']; project: string; node: string; session: number }
export function NameRecognitionCard({card,close}:{card:NameCard;close:()=>void}) {
  const data = useAppStore(state=>state.data)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const candidates = data?.entities.filter(entity=>card.ids.includes(entity.id)) ?? []
  function current() {
    const state=useAppStore.getState()
    return state.projectPath===card.project && state.projectSession===card.session && state.document?.node.id===card.node && card.view.dom.isConnected && card.view.state.doc===card.version
  }
  async function ignore(entityId?:string) {
    if(!current()){close();return}
    setBusy(true)
    try {
      await useAppStore.getState().saveEntity({projectPath:card.project,id:null,kind:'mention-ignore',title:entityId ? candidates.find(e=>e.id===entityId)!.title : card.text,tags:['正文自动识别'],content:entityId?{entityId}:{text:card.text}})
      close()
    } catch(reason){setError(String(reason))} finally{setBusy(false)}
  }
  function pin(id:string) {
    const state=useAppStore.getState(), entity=state.data?.entities.find(item=>item.id===id)
    if(!entity || !current() || isNodeLocked(state.data?.nodes ?? [],card.node)){setError('正文或资料已变化，或章节已锁定，请关闭后重试。');return}
    if(state.data!.entities.filter(item=>nameKey(item.title)===nameKey(entity.title)).length!==1 || /[\]\r\n[]/.test(entity.title)){setError('同名或特殊字符名称无法安全固定，请先修改资料名称。');return}
    card.view.dispatch({changes:{from:card.from,to:card.to,insert:'[['+entity.title+']]'},userEvent:'input.name-link'})
    close();card.view.focus()
  }
  return <Modal open title={'识别资料 · '+card.text} onClose={close}>
    <p className="field-hint">{candidates.length>1?'找到同名条目，请选择要查看的资料。':'名称匹配提示，不代表已确认语义关联。'} 固定关联会将此处改为资料正式名称的 [[链接]]。</p>
    <div className="name-recognition-list">{candidates.map(entity=><section key={entity.id}><h3>{entity.title} <small>{ENTITY_LABELS[entity.kind]}</small></h3><p>{String(entity.content.summary || entity.content.description || entity.content.personality || '暂无简介').slice(0,240)}</p><small>{entity.filePath}</small><div className="name-recognition-actions"><Button disabled={busy} onClick={()=>{if(current()){close();useAppStore.getState().selectEntity(entity.kind,entity.id)}else close()}}>查看资料</Button><Button disabled={busy || isNodeLocked(data?.nodes ?? [],card.node)} variant="outline" onClick={()=>pin(entity.id)}>固定关联</Button><Button disabled={busy} variant="ghost" onClick={()=>void ignore(entity.id)}>不再识别此条目</Button></div></section>)}</div>
    {error?<p role="alert">{error}</p>:null}<Button disabled={busy} variant="ghost" onClick={()=>void ignore()}>忽略此名称</Button>
  </Modal>
}
export function NameRecognitionSettings() {
  const preferences=useAppStore(state=>state.workspacePreferences)
  const data=useAppStore(state=>state.data)
  const [busy,setBusy]=useState<string|null>(null)
  const [error,setError]=useState('')
  async function restore(id:string){setBusy(id);setError('');try{await useAppStore.getState().deleteEntity(id)}catch(reason){setError(String(reason))}finally{setBusy(null)}}
  const ignored=data?.entities.filter(entity=>entity.kind==='mention-ignore') ?? []
  return <section className="settings-card name-recognition-settings"><h2>正文名称自动识别</h2><label><input type="checkbox" checked={preferences.autoRecognizeNames!==false} onChange={event=>useAppStore.getState().setWorkspacePreferences({autoRecognizeNames:event.target.checked})}/> 自动标记已有的人物、地点和世界观名称</label><p className="field-hint">别名在对应资料的“别名”字段中填写，可用逗号分隔。仅显示提示，不会自动修改或发送正文；单字名称不参与识别。以下忽略项仅用于当前项目。</p><details><summary>管理忽略项（{ignored.length}）</summary><div className="name-recognition-list">{ignored.map(entity=><div key={entity.id}><span>{entity.title} · {entity.content.entityId?'条目':'名称'}</span><Button disabled={busy!==null} variant="ghost" onClick={()=>void restore(entity.id)}>恢复识别</Button></div>)}</div></details>{error?<p role="alert">{error}</p>:null}</section>
}
