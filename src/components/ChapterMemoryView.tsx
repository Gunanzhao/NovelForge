import { sourceRangeFromNormalizedText } from '../lib/newline-offsets'
import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../lib/api'
import { MEMORY_FIELDS, blankMemoryFields, memoryStatus, parseChapterMemory, useMemoryImport, type MemoryDraft, type MemoryField } from '../lib/chapter-memory'
import { entityState } from '../lib/entity-history'
import { locateTextAnchor } from '../lib/annotations'
import { jumpToText } from '../lib/text-navigation'
import { markDraftSaved, runGuarded, setDraftSaving } from '../lib/draft-guard'
import { useUnsavedDraft } from '../hooks/useUnsavedDraft'
import type { EntityRecord } from '../lib/types'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, Field } from './ui'
export function ChapterMemoryView(){
  const identity=useAppStore(state=>state.projectPath+':'+state.projectSession)
  return <ChapterMemoryWorkspace key={identity}/>
}
function ChapterMemoryWorkspace(){
  const data=useAppStore(state=>state.data),document=useAppStore(state=>state.document),path=useAppStore(state=>state.projectPath),session=useAppStore(state=>state.projectSession)
  const imported=useMemoryImport(state=>state.draft)
  const [chapterId,setChapterId]=useState(imported?.projectPath===path&&imported.session===session?imported.chapterId:document?.node.id??data?.nodes.find(node=>node.kind==='chapter')?.id??'')
  if(!data||!path)return null
  const chapters=data.nodes.filter(node=>node.kind!=='volume')
  return <div className="workspace-view chapter-memory-view"><div className="view-header"><div><p className="eyebrow">STORY MEMORY</p><h1>章节摘要与故事记忆</h1><p>先审阅草稿与原文依据，再确认用于后续写作。正文改动后须重新核对。</p></div></div><div className="memory-workspace"><aside className="memory-chapters" aria-label="记忆来源章节">{chapters.map(chapter=><button key={chapter.id} className={chapter.id===chapterId?'active':''} onClick={()=>runGuarded(()=>setChapterId(chapter.id))}>{chapter.title}<small>{data.entities.some(entity=>entity.kind==='chapter-memory'&&entity.content.chapterId===chapter.id)?'已有记忆记录':'待整理'}</small></button>)}</aside><div className="memory-editor-region">{chapters.some(chapter=>chapter.id===chapterId)?<MemoryEditor key={path+':'+chapterId} projectPath={path} chapterId={chapterId}/>:<p>请先创建或选择章节。</p>}</div></div></div>
}
function MemoryEditor({projectPath,chapterId}:{projectPath:string;chapterId:string}){
  const data=useAppStore(state=>state.data),live=useAppStore(state=>state.document?.node.id===chapterId?state.document:null)
  const saved=data?.entities.find(entity=>entity.kind==='chapter-memory'&&entity.content.chapterId===chapterId)
  const [snapshot,setSnapshot]=useState<EntityRecord|undefined>(()=>saved?structuredClone(saved):undefined),[draft,setDraft]=useState<MemoryDraft|null>(null),[baseline,setBaseline]=useState('')
  const [disk,setDisk]=useState<string|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [field,setField]=useState<MemoryField>('summary'),[range,setRange]=useState<{from:number;to:number}|null>(null)
  const pending=useRef(false),mounted=useRef(true),newId=useRef(saved?.id??crypto.randomUUID()),textRef=useRef<HTMLTextAreaElement|null>(null)
  const draftId='chapter-memory:'+projectPath+':'+chapterId
  const dirty=Boolean(draft&&JSON.stringify(draft)!==baseline)
  const currentText=live?.content??disk
  const storedMemory=snapshot?parseChapterMemory(snapshot):null
  const status=storedMemory?memoryStatus(storedMemory,currentText):'draft'
  function reset(){newId.current=saved?.id??newId.current;const memory=saved?parseChapterMemory(saved):null;const next=memory?{chapterId,sourceText:memory.sourceText,fields:memory.fields,sources:memory.sources}:{chapterId,sourceText:currentText??'',fields:blankMemoryFields(),sources:[]};setSnapshot(saved?structuredClone(saved):undefined);setDraft(next);setBaseline(JSON.stringify(next));setError('');setNotice('');setRange(null);markDraftSaved(draftId)}
  useUnsavedDraft(draftId,'章节记忆',dirty,()=>save(false),reset, { targetId: 'chapter-memory:' + chapterId, payload: draft })
  useEffect(()=>{
    mounted.current=true
    let active=true
    const memory=saved?parseChapterMemory(saved):null
    void projectApi.getDocument({projectPath,nodeId:chapterId}).then(document=>{
      if(!active)return
      setDisk(document.content)
      const imported=useMemoryImport.getState().draft,session=captureProjectSession()
      const savedDraft:MemoryDraft=memory?{chapterId,sourceText:memory.sourceText,fields:memory.fields,sources:memory.sources}:{chapterId,sourceText:document.content,fields:blankMemoryFields(),sources:[]}
      setBaseline(JSON.stringify(savedDraft))
      if(imported?.projectPath===projectPath&&imported.session===session.generation&&imported.chapterId===chapterId){setDraft({chapterId,sourceText:imported.sourceText,fields:imported.fields,sources:imported.sources});useMemoryImport.setState({draft:null});setNotice('完整AI结果已填入待审阅草稿，尚未保存或确认。')}
      else setDraft(savedDraft)
    }).catch(error=>{if(active)setError(String(error))})
    return()=>{active=false;mounted.current=false}
    // This editor is keyed by project/chapter. Later entity changes must not reset drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[projectPath,chapterId])
  async function save(confirm:boolean){
    if(pending.current||!draft||!Object.values(draft.fields).some(text=>text.trim()))return false
    const session=captureProjectSession();if(session.path!==projectPath)return false
    pending.current=true;setBusy(true);setDraftSaving(draftId,true);setError('');setNotice('')
    try{
      let result
      if(confirm){
        if(dirty||!snapshot)throw new Error('请先保存并审阅草稿，再确认记忆。')
        if(live&&!await useAppStore.getState().saveCurrentDocument('确认章节记忆前保存'))return false
        if(!isCurrentProjectSession(session))return false
        result=await projectApi.confirmChapterMemory({projectPath,entityId:snapshot.id,expected:entityState(snapshot)})
      }else result=await projectApi.upsertEntity({projectPath,id:newId.current,kind:'chapter-memory',title:(data?.nodes.find(node=>node.id===chapterId)?.title??'章节')+' · 记忆',tags:[],content:{chapterId,sourceText:draft.sourceText,...draft.fields,sources:draft.sources,status:'draft'}},snapshot?entityState(snapshot):undefined)
      if(!mounted.current||!isCurrentProjectSession(session))return false
      const entity=result.entities.find(entity=>entity.id===newId.current)!;setSnapshot(structuredClone(entity));setBaseline(JSON.stringify(draft));markDraftSaved(draftId);await useAppStore.getState().refreshData(result,true,session);setNotice(confirm?'作者确认已保存。可在AI参考资料中勾选这份记忆。':'草稿已保存；尚未纳入已确认记忆。');return true
    }catch(error){if(mounted.current&&isCurrentProjectSession(session))setError(String(error));return false}
    finally{pending.current=false;setDraftSaving(draftId,false);if(mounted.current)setBusy(false)}
  }
  function addSource(){if(!draft||!range||range.from===range.to)return;const source={id:crypto.randomUUID(),field,from:range.from,to:range.to,quote:draft.sourceText.slice(range.from,range.to)};if(draft.sources.some(item=>item.field===field&&item.from===range.from&&item.to===range.to))return;setDraft({...draft,sources:[...draft.sources,source]})}
  async function jump(from:number,to:number){if(!draft||currentText===undefined)return;const location=locateTextAnchor({sourceText:draft.sourceText,from,to},currentText);if(location.orphaned){setError('这处来源已变化，无法可靠定位，请核对当前正文。');return}try{await jumpToText(chapterId,currentText,location.from,location.to)}catch(error){setError(String(error))}}
  if(!draft)return <div className="archive-editor-detail">{error?<p role="alert">{error}</p>:<p>读取章节记忆…</p>}</div>
  const stale=draft.sourceText!==currentText
  return <section className="archive-editor-detail memory-editor" aria-label="章节记忆编辑"><h2>{data?.nodes.find(node=>node.id===chapterId)?.title}</h2><p role="status">{dirty?'草稿有未保存修改':status==='confirmed'?'作者已确认':status==='stale'?'已过期：正文发生变化':status==='unavailable'?'来源章节不可读取':'待作者审阅的草稿'}</p>
    {stale&&<div className="memory-stale"><p>当前正文与这份草稿的依据不同。旧记忆不会进入已确认上下文，请对照新正文重新核对。</p><Button variant="outline" disabled={busy||currentText===undefined} onClick={()=>{setDraft({...draft,sourceText:currentText!,sources:[]});setRange(null);setNotice('已切换到当前正文，旧来源已清空；请核对全部字段并重新添加依据。')}}>以当前正文重新核对</Button></div>}
    <div className="memory-fields" inert={busy}>{(Object.entries(MEMORY_FIELDS) as Array<[MemoryField,string]>).map(([key,label])=><Field key={key} label={label}><textarea className="text-area" value={draft.fields[key]} onChange={event=>setDraft({...draft,fields:{...draft.fields,[key]:event.target.value}})} placeholder={key==='next'?'记录承接事项与待核对问题，不自动修改正文':'没有明确依据时留空，或注明待核对。'}/></Field>)}</div>
    <details className="memory-source-picker"><summary>原文依据（{draft.sources.length}处）· 选择来源段落</summary><p className="field-hint">在下方原文中选择支持某项记录的段落，再添加依据。AI生成的引文只有与原文精确匹配时才会列入。</p><textarea ref={textRef} className="text-area memory-source-text" readOnly aria-label="记忆依据原文" value={draft.sourceText} onSelect={()=>{const element=textRef.current;if(element)setRange(sourceRangeFromNormalizedText(draft.sourceText,element.selectionStart,element.selectionEnd))}}/><Field label="依据对应字段"><select className="select-input" disabled={busy} value={field} onChange={event=>setField(event.target.value as MemoryField)}>{Object.entries(MEMORY_FIELDS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Button variant="outline" disabled={busy||!range||range.from===range.to} onClick={addSource}>添加所选原文依据</Button></details>
    <div className="memory-sources">{draft.sources.map(source=><div className="memory-source" key={source.id}><strong>{MEMORY_FIELDS[source.field]}</strong><blockquote>{source.quote}</blockquote><div className="entity-actions"><Button variant="outline" disabled={busy} onClick={()=>void jump(source.from,source.to)}>定位来源段落</Button><Button variant="ghost" disabled={busy} onClick={()=>setDraft({...draft,sources:draft.sources.filter(item=>item.id!==source.id)})}>移除这处依据</Button></div></div>)}</div>
    <div className="entity-actions"><Button disabled={busy||!Object.values(draft.fields).some(text=>text.trim())} onClick={()=>void save(false)}>保存记忆草稿</Button><Button variant="outline" disabled={busy||dirty||!snapshot||stale||!draft.sources.length||status==='confirmed'} onClick={()=>void save(true)}>确认这份章节记忆</Button><Button variant="ghost" disabled={busy} onClick={reset}>放弃修改并重新加载</Button></div>
    <p className="field-hint">确认不代表自动改正文；连续性疑点仍由你判断。编辑并保存草稿会撤销其已确认状态。</p>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>
}
