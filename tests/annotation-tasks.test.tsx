import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AnnotationTasks } from '../src/components/AnnotationTasks'
import { projectApi } from '../src/lib/api'
import { clearAnnotationLocations } from '../src/lib/annotations'
import { useAppStore } from '../src/stores/app-store'
import { useTextNavigation } from '../src/lib/text-navigation'
afterEach(()=>{cleanup();vi.restoreAllMocks();clearAnnotationLocations()})
async function fixture(){
 const path='annotations-'+crypto.randomUUID();const data=await projectApi.create({path,title:'批注测试',author:'',description:'',genre:'',targetWords:1});const node=data.nodes.find(node=>node.kind==='chapter')!;const content='开场正文。目标段落。结尾正文。'
 const document=await projectApi.saveDocument({projectPath:path,nodeId:node.id,content,reason:'测试'});
 useAppStore.setState({...useAppStore.getInitialState(),projectPath:path,data,document:{...document,persistedContent:content},saveState:'saved',activeView:'manuscript',editorSelection:{nodeId:node.id,from:5,to:9,text:'目标段落'}})
 return {path,data,node,document}
}
async function add(){fireEvent.click(screen.getByRole('button',{name:'批注当前选区'}));fireEvent.change(screen.getByLabelText('批注内容'),{target:{value:'核对人物在此处知道的线索'}});fireEvent.click(screen.getByRole('button',{name:'保存批注'}));await screen.findByRole('button',{name:'标记已解决'})}
it('creates a selection annotation and filters resolved tasks without editing the manuscript',async()=>{
 const {document}=await fixture();render(<AnnotationTasks compact/>);await add();expect(useAppStore.getState().document!.content).toBe(document.content)
 const annotation=useAppStore.getState().data!.entities.find(entity=>entity.kind==='annotation')!;expect(annotation.content).toMatchObject({sourceText:document.content,from:5,to:9,status:'open'})
 fireEvent.click(screen.getByRole('button',{name:'标记已解决'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'标记已解决'})).toBeNull())
 fireEvent.change(screen.getByLabelText('处理状态'),{target:{value:'resolved'}});expect(screen.getByRole('button',{name:'重新打开'})).toBeTruthy()
})
it('retains a comment draft and blocks creation if its captured source has changed',async()=>{
 const {document}=await fixture();render(<AnnotationTasks compact/>);fireEvent.click(screen.getByRole('button',{name:'批注当前选区'}));fireEvent.change(screen.getByLabelText('批注内容'),{target:{value:'保留我的批注'}})
 act(()=>useAppStore.getState().updateContent(document.content+'新增段落'))
 fireEvent.click(screen.getByRole('button',{name:'保存批注'}));await screen.findByRole('alert');expect((screen.getByLabelText('批注内容') as HTMLTextAreaElement).value).toBe('保留我的批注');expect(useAppStore.getState().data!.entities.some(entity=>entity.kind==='annotation')).toBe(false)
})
it('requests a guarded text jump to the current mapped range',async()=>{
 await fixture();render(<AnnotationTasks compact/>);await add();fireEvent.click(screen.getByRole('button',{name:'定位原文'}));await waitFor(()=>expect(useTextNavigation.getState().request?.from).toBe(5));expect(useTextNavigation.getState().request?.to).toBe(9)
})
it('global tasks retain orphan markers after reloading the document and filter by category',async()=>{
 const {path,data,node}=await fixture();const source='重复段落。重复段落。';const changed=await projectApi.upsertEntity({projectPath:path,id:'a',kind:'annotation',title:'需要核对',content:{chapterId:node.id,sourceText:source,from:0,to:4,anchorRevision:'r',body:'待核对重复段落',category:'continuity',status:'open'},tags:[]})
 await projectApi.saveDocument({projectPath:path,nodeId:node.id,content:'重复段落。',reason:'测试',annotationAnchors:[{id:'a',revision:'r',from:0,to:0,orphaned:true}]})
 clearAnnotationLocations();useAppStore.setState({data:{...data,entities:changed.entities},document:null,activeView:'annotation'})
 render(<AnnotationTasks/>);fireEvent.change(screen.getByLabelText('处理状态'),{target:{value:'orphaned'}})
 await screen.findByText(/原文已删除或无法可靠定位/);expect((screen.getByRole('button',{name:'定位原文'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('批注分类筛选'),{target:{value:'research'}});expect(screen.queryByText('待核对重复段落')).toBeNull()
})
it('ignores annotation saves that complete after switching projects',async()=>{
 const {data}=await fixture();let done!:(value:typeof data)=>void;vi.spyOn(projectApi,'upsertEntity').mockImplementation(()=>new Promise(resolve=>{done=resolve}))
 render(<AnnotationTasks compact/>);fireEvent.click(screen.getByRole('button',{name:'批注当前选区'}));fireEvent.change(screen.getByLabelText('批注内容'),{target:{value:'旧项目批注'}});fireEvent.click(screen.getByRole('button',{name:'保存批注'}));await waitFor(()=>expect(done).toBeTruthy())
 act(()=>useAppStore.setState({projectPath:'new-project',projectSession:2,data:{...data,project:{...data.project,id:'new'}}}));await act(async()=>done(data));expect(useAppStore.getState().data!.project.id).toBe('new')
})
