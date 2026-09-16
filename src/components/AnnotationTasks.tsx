import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../lib/api'
import { ANNOTATION_CATEGORIES, annotationLocation, chapterAnnotations, type AnnotationCategory, type ManuscriptAnnotation, type TextAnchor } from '../lib/annotations'
import { entityState } from '../lib/entity-history'
import { jumpToText } from '../lib/text-navigation'
import { markDraftSaved, setDraftSaving } from '../lib/draft-guard'
import { useUnsavedDraft } from '../hooks/useUnsavedDraft'
import type { DocumentData } from '../lib/types'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, Field } from './ui'
export function AnnotationTasks({compact=false}:{compact?:boolean}) {
  const identity=useAppStore(state=>JSON.stringify([state.projectPath,state.projectSession,compact?state.document?.node.id:null]))
  return <AnnotationTasksContent key={identity} compact={compact}/>
}
function AnnotationTasksContent({compact}:{compact:boolean}) {
  const data=useAppStore(state=>state.data),document=useAppStore(state=>state.document),projectPath=useAppStore(state=>state.projectPath),selection=useAppStore(state=>state.editorSelection)
  const [anchor,setAnchor]=useState<(TextAnchor&{chapterId:string})|null>(null),[body,setBody]=useState(''),[category,setCategory]=useState<AnnotationCategory>('revision')
  const [statusFilter,setStatusFilter]=useState('open'),[categoryFilter,setCategoryFilter]=useState('all'),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [documents,setDocuments]=useState<Record<string,DocumentData>>({}),[loading,setLoading]=useState(false)
  const pending=useRef(false),newId=useRef(crypto.randomUUID()),mounted=useRef(true)
  const draftId='annotation:'+projectPath+':'+String(compact)
  const dirty=body.trim().length>0
  function discard(){setBody('');setAnchor(null);newId.current=crypto.randomUUID()}
  useUnsavedDraft(draftId,'正文批注',dirty,save,discard)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{
    if(compact||!projectPath||!data)return
    let active=true;setLoading(true)
    const nodes=data.nodes.filter(node=>node.kind!=='volume')
    void (async()=>{const result:Record<string,DocumentData>={};for(let offset=0;offset<nodes.length;offset+=8){const items=await Promise.all(nodes.slice(offset,offset+8).map(node=>projectApi.getDocument({projectPath,nodeId:node.id})));if(!active)return;for(const item of items)result[item.node.id]=item}if(active)setDocuments(result)})().catch(error=>{if(active)setError(String(error))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[compact,projectPath,data])
  if(!data||!projectPath)return null
  const annotations=chapterAnnotations(data.entities,compact?document?.node.id:undefined)
  function currentDocument(item:ManuscriptAnnotation){return document?.node.id===item.chapterId?document:documents[item.chapterId]}
  function location(item:ManuscriptAnnotation){const doc=currentDocument(item);return doc?annotationLocation(item,doc.content,doc.annotationTracking):null}
  const visible=annotations.filter(item=>(categoryFilter==='all'||item.category===categoryFilter)&&(statusFilter==='all'||statusFilter===item.status||statusFilter==='orphaned'&&(location(item)?.orphaned||!data.nodes.some(node=>node.id===item.chapterId))))
  function start(){if(!document||!selection||selection.nodeId!==document.node.id||selection.to<=selection.from||document.content.slice(selection.from,selection.to)!==selection.text)return;setAnchor({chapterId:document.node.id,sourceText:document.content,from:selection.from,to:selection.to});setError('')}
  async function save(){
    if(pending.current||!anchor||!body.trim()||!projectPath)return false
    const session=captureProjectSession();pending.current=true;setBusy(true);setDraftSaving(draftId,true);setError('')
    try{
      if(useAppStore.getState().document?.node.id!==anchor.chapterId||useAppStore.getState().document?.content!==anchor.sourceText)throw new Error('正文已变化，请重新选取批注原文。')
      if(!await useAppStore.getState().saveCurrentDocument('添加批注前保存')||!isCurrentProjectSession(session))return false
      if(useAppStore.getState().document?.content!==anchor.sourceText)throw new Error('保存期间正文已变化，请重新选取原文。')
      const result=await projectApi.upsertEntity({projectPath,id:newId.current,kind:'annotation',title:body.trim().slice(0,40),content:{...anchor,anchorRevision:newId.current,body:body.trim(),category,status:'open'},tags:[]})
      if(!mounted.current||!isCurrentProjectSession(session))return false
      await useAppStore.getState().refreshData(result,true,session);discard();markDraftSaved(draftId);return true
    }catch(error){if(mounted.current&&isCurrentProjectSession(session))setError(String(error));return false}
    finally{pending.current=false;setDraftSaving(draftId,false);if(mounted.current)setBusy(false)}
  }
  async function toggle(item:ManuscriptAnnotation){
    if(pending.current)return
    const session=captureProjectSession();pending.current=true;setBusy(true);setDraftSaving(draftId,true);setError('')
    try{const entity=item.entity;const result=await projectApi.upsertEntity({projectPath:projectPath!,id:entity.id,kind:'annotation',title:entity.title,tags:entity.tags,content:{...entity.content,status:item.status==='open'?'resolved':'open'}},entityState(entity));if(mounted.current&&isCurrentProjectSession(session))await useAppStore.getState().refreshData(result,true,session)}
    catch(error){if(mounted.current&&isCurrentProjectSession(session))setError(String(error))}
    finally{pending.current=false;setDraftSaving(draftId,false);if(mounted.current)setBusy(false)}
  }
  async function jump(item:ManuscriptAnnotation){const doc=currentDocument(item),range=location(item);if(!doc||!range||range.orphaned)return;try{await jumpToText(item.chapterId,doc.content,range.from,range.to)}catch(error){setError(String(error))}}
  return <section className={compact?'annotation-tasks annotation-tasks-compact':'workspace-view annotation-tasks'} aria-label="批注与修订任务">
    {!compact&&<div className="view-header"><div><p className="eyebrow">REVISION TASKS</p><h1>批注与修订任务</h1><p>全书批注集中处理。定位依据原文和编辑记录；已删除的原文会标记失联。</p></div></div>}
    <div className={compact?'annotation-content':'archive-editor-detail annotation-content'}>
      {compact&&<div className="annotation-composer"><Button variant="outline" disabled={busy||!selection?.text.trim()} onClick={start}>批注当前选区</Button>{anchor&&<><blockquote>{anchor.sourceText.slice(anchor.from,anchor.to)}</blockquote><Field label="批注分类"><select className="select-input" disabled={busy} value={category} onChange={event=>setCategory(event.target.value as AnnotationCategory)}>{Object.entries(ANNOTATION_CATEGORIES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field><Field label="批注内容"><textarea className="text-area" disabled={busy} value={body} onChange={event=>setBody(event.target.value)} /></Field><div className="entity-actions"><Button disabled={busy||!body.trim()} onClick={()=>void save()}>保存批注</Button><Button variant="ghost" disabled={busy} onClick={discard}>放弃批注</Button></div></>}</div>}
      <div className="annotation-filters"><Field label="处理状态"><select className="select-input" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="open">待处理</option><option value="resolved">已解决</option><option value="orphaned">原文失联</option><option value="all">全部</option></select></Field><Field label="批注分类筛选"><select className="select-input" value={categoryFilter} onChange={event=>setCategoryFilter(event.target.value)}><option value="all">全部分类</option>{Object.entries(ANNOTATION_CATEGORIES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field></div>
      {error&&<p role="alert">{error}</p>}{loading&&<p role="status">读取全书批注位置…</p>}
      <div className="annotation-list">{visible.map(item=>{const range=location(item),missing=!data.nodes.some(node=>node.id===item.chapterId);return <article className="annotation-card" key={item.id}><div><strong>{ANNOTATION_CATEGORIES[item.category]} · {item.status==='open'?'待处理':'已解决'}</strong><small>{data.nodes.find(node=>node.id===item.chapterId)?.title??'原章节不存在'}</small></div><blockquote>{item.sourceText.slice(item.from,item.to)}</blockquote><p>{item.body}</p>{(missing||range?.orphaned)&&<p className="annotation-orphan" role="status">原文已删除或无法可靠定位；批注保留，需人工核对。</p>}<div className="entity-actions"><Button variant="outline" disabled={busy||!range||range.orphaned||missing} onClick={()=>void jump(item)}>定位原文</Button><Button variant="outline" disabled={busy} onClick={()=>void toggle(item)}>{item.status==='open'?'标记已解决':'重新打开'}</Button></div></article>})}{!visible.length&&!loading&&<p className="field-hint">没有符合筛选条件的批注。</p>}</div>
      {compact&&<Button variant="ghost" onClick={()=>useAppStore.getState().setView('annotation')}>查看全书修订任务</Button>}
    </div>
  </section>
}
