import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../lib/api'
import { registerDraft, setDraftSaving } from '../lib/draft-guard'
import { writeClipboardText } from '../lib/clipboard'
import type { RecoveryItem } from '../lib/types'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'
export function RecoveryCenter({projectPath}:{projectPath:string}) {
  const nodes=useAppStore(state=>state.data?.nodes??[])
  const [items,setItems]=useState<RecoveryItem[]>([]),[selected,setSelected]=useState('')
  const [content,setContent]=useState<string|null>(null),[title,setTitle]=useState(''),[parent,setParent]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[attempt,setAttempt]=useState(0)
  const generation=useRef(0),pending=useRef(false),request=useRef({signature:'',id:''})
  const guardId='recovery-center:'+projectPath
  useEffect(()=>registerDraft({id:guardId,label:'恢复稿另存',dirty:false,save:async()=>false,discard:()=>{}}),[guardId])
  useEffect(()=>{
    const request=++generation.current;setSelected('');setContent(null);setError('')
    void projectApi.listRecovery(projectPath).then(items=>{if(generation.current===request)setItems(items)}).catch(error=>{if(generation.current===request)setError(String(error))})
    // This ref is a request counter, not a DOM node; invalidate even newer selections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{generation.current++}
  },[projectPath,attempt])
  async function select(id:string){
    const version=++generation.current;setSelected(id);setContent(null);setError('');setMessage('');setTitle('');request.current={signature:'',id:''}
    if(!id)return
    try{const content=await projectApi.readRecovery({projectPath,recoveryId:id});if(generation.current===version){setContent(content);setTitle('恢复稿 · '+(items.find(item=>item.id===id)?.nodeTitle??'新章节'))}}
    catch(error){if(generation.current===version)setError(String(error))}
  }
  async function save(){
    if(pending.current||content===null||!parent||!title.trim())return
    const session=captureProjectSession(),version=generation.current
    if(session.path!==projectPath)return
    const input={projectPath,recoveryId:selected,expectedContent:content,parentId:parent,title:title.trim()}
    const signature=JSON.stringify(input);if(request.current.signature!==signature)request.current={signature,id:crypto.randomUUID()}
    pending.current=true;setBusy(true);setDraftSaving(guardId,true);setError('');setMessage('')
    try{const data=await projectApi.recoveryAsChapter({...input,requestId:request.current.id});if(!isCurrentProjectSession(session)||version!==generation.current)return;await useAppStore.getState().refreshData(data,true,session);setMessage('已另存为新章节；原恢复稿仍保留，可继续核对。')}
    catch(error){if(isCurrentProjectSession(session)&&version===generation.current)setError(String(error))}
    finally{pending.current=false;setDraftSaving(guardId,false);if(isCurrentProjectSession(session))setBusy(false)}
  }
  const item=items.find(item=>item.id===selected)
  return <Panel className="settings-card recovery-center"><h2>恢复草稿</h2><p className="field-hint">恢复稿独立于正文历史。即使原章节已删除，也可查看、复制或另存为新章节。</p>
    <Field label="待处理恢复稿"><select className="select-input" disabled={busy} value={selected} onChange={event=>void select(event.target.value)}><option value="">选择恢复内容（{items.length}份）</option>{items.map(item=><option key={item.id} value={item.id}>{item.nodeTitle} · {item.createdAt}{!nodes.some(node=>node.id===item.nodeId)?' · 原章节不可用':''}</option>)}</select></Field>
    <Button variant="outline" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>刷新恢复列表</Button>
    {selected&&content===null&&!error&&<p role="status">读取恢复稿中…</p>}
    {content!==null&&<div className="recovery-center-detail"><textarea className="text-area recovery-center-text" readOnly aria-label="恢复稿内容" value={content}/><Button variant="outline" onClick={()=>void writeClipboardText(content).then(ok=>ok?setMessage('恢复稿已复制'):setError('复制失败，请从文本框手动复制。'))}>复制恢复稿</Button>
      {item&&!nodes.some(node=>node.id===item.nodeId)&&<p>原章节不可用，请另存为新章节。</p>}
      <div className="backup-policy-grid"><Field label="另存到卷"><select className="select-input" disabled={busy} value={parent} onChange={event=>setParent(event.target.value)}><option value="">选择目标卷</option>{nodes.filter(node=>node.kind==='volume').map(node=><option key={node.id} value={node.id} disabled={node.status==='locked'}>{node.title}</option>)}</select></Field><Field label="新章节名称"><TextInput disabled={busy} value={title} onChange={event=>setTitle(event.target.value)}/></Field></div>
      <Button disabled={busy||!parent||!title.trim()} onClick={()=>void save()}>另存为新章节</Button>
    </div>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </Panel>
}
