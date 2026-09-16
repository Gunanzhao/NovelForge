import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WikiRenamePanel } from '../src/components/WikiRenamePanel'
import { projectApi } from '../src/lib/api'
import { planWikiRename, selectedWikiRenameChanges } from '../src/lib/wiki-rename'
import { useAppStore } from '../src/stores/app-store'
afterEach(() => {cleanup();vi.restoreAllMocks()})
async function fixture() {
  const path='wiki-panel-'+crypto.randomUUID()
  const first=await projectApi.create({path,title:'改名测试',author:'',description:'',genre:'',targetWords:1})
  const chapter=first.nodes.find(node=>node.kind==='chapter')!
  await projectApi.saveDocument({projectPath:path,nodeId:chapter.id,content:'林月遇到[[林月]]，然后[[林月]]离开。',reason:'测试'})
  const data=await projectApi.upsertEntity({projectPath:path,id:'person',kind:'character',title:'林月',content:{identity:'医师'},tags:[]})
  const document=await projectApi.getDocument({projectPath:path,nodeId:chapter.id})
  useAppStore.setState({...useAppStore.getInitialState(),projectPath:path,data,document:{...document,persistedContent:document.content},saveState:'saved',activeView:'character',selectedEntityId:'person'})
  return {path,data,document,entity:data.entities.find(entity=>entity.id==='person')!}
}
function Harness({path}:{path:string}) {
  const entity=useAppStore(state=>state.data!.entities.find(entity=>entity.id==='person')!)
  return <WikiRenamePanel entity={entity} projectPath={path} />
}
async function preview() {
  fireEvent.click(screen.getByRole('button',{name:'Wiki安全改名'}))
  fireEvent.change(screen.getByLabelText('新资料名称'),{target:{value:'林遥'}})
  fireEvent.click(screen.getByRole('button',{name:'预览改名影响'}))
  await screen.findByRole('button',{name:'确认改名并更新所选引用'})
}
it('applies selected references, preserves plain text and refreshes current saved body without leaving archive',async()=>{
  const {path,document}=await fixture();render(<Harness path={path} />);await preview()
  fireEvent.click(screen.getByRole('checkbox',{name:/更新引用 2/}))
  fireEvent.click(screen.getByRole('button',{name:'确认改名并更新所选引用'}))
  await waitFor(()=>expect(useAppStore.getState().data!.entities.find(entity=>entity.id==='person')!.title).toBe('林遥'))
  expect(useAppStore.getState().document!.content).toBe('林月遇到[[林遥]]，然后[[林月]]离开。')
  expect(useAppStore.getState().document!.persistedContent).toBe(useAppStore.getState().document!.content)
  expect(useAppStore.getState().activeView).toBe('character')
  expect(useAppStore.getState().data!.entities.find(entity=>entity.id==='person')!.content.alias).toBe('林月')
  await waitFor(()=>expect(screen.getByLabelText('改名操作记录')).toBeTruthy())
  const [operation]=await projectApi.listWikiRenames({projectPath:path,targetId:'person'})
  fireEvent.change(screen.getByLabelText('改名操作记录'),{target:{value:operation.id}})
  fireEvent.click(screen.getByRole('button',{name:'撤销整次改名'}))
  await waitFor(()=>expect(useAppStore.getState().document!.content).toBe(document.content))
  expect(useAppStore.getState().data!.entities.find(entity=>entity.id==='person')!.title).toBe('林月')
})
it('rejects stale batch atomically and never changes another record first',async()=>{
  const {path,data,document}=await fixture()
  const plan=planWikiRename(data,{[document.node.id]:document.content},'person','林遥')
  const changes=selectedWikiRenameChanges(plan,plan.references.map(reference=>reference.id))
  await projectApi.upsertEntity({projectPath:path,id:'person',kind:'character',title:'林月',content:{identity:'后续修改'},tags:[]})
  await expect(projectApi.applyWikiRename({projectPath:path,targetId:'person',changes})).rejects.toThrow('资料已变化')
  expect((await projectApi.getDocument({projectPath:path,nodeId:document.node.id})).content).toBe(document.content)
  expect(await projectApi.listWikiRenames({projectPath:path,targetId:'person'})).toEqual([])
})
it('invalidates preview when the proposed name changes',async()=>{
  const {path}=await fixture();render(<Harness path={path} />);await preview()
  fireEvent.change(screen.getByLabelText('新资料名称'),{target:{value:'另一个名字'}})
  expect(screen.queryByRole('button',{name:'确认改名并更新所选引用'})).toBeNull()
})
it('discards manuscript reads that finish after changing entity',async()=>{
  const {path,entity,document}=await fixture()
  let done!: (value:typeof document)=>void
  vi.spyOn(projectApi,'getDocument').mockImplementation(()=>new Promise(resolve=>{done=resolve}))
  const view=render(<WikiRenamePanel entity={entity} projectPath={path} />)
  fireEvent.click(screen.getByRole('button',{name:'Wiki安全改名'}));fireEvent.change(screen.getByLabelText('新资料名称'),{target:{value:'林遥'}});fireEvent.click(screen.getByRole('button',{name:'预览改名影响'}))
  view.rerender(<WikiRenamePanel entity={{...entity,id:'other',title:'其他资料'}} projectPath={path} />)
  await act(async()=>done(document))
  expect(screen.queryByRole('button',{name:'确认改名并更新所选引用'})).toBeNull()
})
it('blocks preview if the loaded manuscript contains unsaved edits',async()=>{
  const {path,document}=await fixture();useAppStore.setState({document:{...document,persistedContent:'old'}})
  render(<Harness path={path} />);fireEvent.click(screen.getByRole('button',{name:'Wiki安全改名'}));fireEvent.change(screen.getByLabelText('新资料名称'),{target:{value:'林遥'}})
  expect((screen.getByRole('button',{name:'预览改名影响'}) as HTMLButtonElement).disabled).toBe(true)
})
it('prevents duplicate apply and unlocks the parent after failed mutation',async()=>{
  const {path,entity}=await fixture();const busy=vi.fn();render(<WikiRenamePanel entity={entity} projectPath={path} onBusyChange={busy} />);await preview()
  let reject!: (reason:Error)=>void
  const apply=vi.spyOn(projectApi,'applyWikiRename').mockImplementation(()=>new Promise((_,fail)=>{reject=fail}))
  fireEvent.click(screen.getByRole('button',{name:'确认改名并更新所选引用'}));fireEvent.click(screen.getByRole('button',{name:'确认改名并更新所选引用'}))
  expect(apply).toHaveBeenCalledTimes(1);expect(busy).toHaveBeenLastCalledWith(true)
  await act(async()=>reject(new Error('磁盘变化')))
  expect(screen.getByRole('alert').textContent).toContain('磁盘变化');expect(busy).toHaveBeenLastCalledWith(false)
})
it('reports committed mutation separately when reloading the manuscript fails',async()=>{
  const {path}=await fixture();render(<Harness path={path} />);await preview()
  vi.spyOn(projectApi,'getDocument').mockRejectedValueOnce(new Error('读取失败'))
  fireEvent.click(screen.getByRole('button',{name:'确认改名并更新所选引用'}))
  await waitFor(()=>expect(useAppStore.getState().data!.entities.find(entity=>entity.id==='person')!.title).toBe('林遥'))
  expect(useAppStore.getState().error).toContain('改名操作已保存')
  expect(screen.getByText(/操作已保存，但正文刷新失败；/)).toBeTruthy()
  expect(await projectApi.listWikiRenames({projectPath:path,targetId:'person'})).toHaveLength(1)
})
