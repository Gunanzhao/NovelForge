import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import type {ProjectData,EntityRecord,NodeRecord} from '../src/lib/types'
const api=vi.hoisted(()=>({search:vi.fn(async()=>[]),setNodeStatus:vi.fn(),copyNode:vi.fn(),saveDocument:vi.fn(),stats:vi.fn()}))
vi.mock('../src/lib/api',()=>({isDesktop:false,projectApi:api}))
vi.mock('../src/components/ContextMenu',()=>({useContextMenu:()=>({openContextMenu:vi.fn()})}))
vi.mock('../src/components/CharacterAppearance',()=>({CharacterAppearancePanel:()=>null}))
import {EntityView} from '../src/components/EntityView'
import {useAppStore} from '../src/stores/app-store'
const node:NodeRecord={id:'c',kind:'chapter',parentId:'v',title:'第一章',orderIndex:0,status:'draft',filePath:'c.md',createdAt:'',updatedAt:''}
const entity:EntityRecord={id:'e',kind:'character',title:'林月',tags:[],content:{},filePath:'e.md',createdAt:'',updatedAt:''}
const data:ProjectData={project:{id:'p',formatVersion:1,title:'审查',author:'',description:'',genre:'',targetWords:0,createdAt:'',updatedAt:''},nodes:[node],entities:[entity],recovery:[]}
beforeEach(()=>{vi.clearAllMocks();useAppStore.setState({...useAppStore.getInitialState(),projectPath:'P',data:structuredClone(data),document:{node,content:'旧稿'},saveState:'saved',selectedEntityId:'e'})})
afterEach(cleanup)
it('人物草稿应在正文树重排序或状态更新后保留',async()=>{
 render(<EntityView kind="character"/>);const input=screen.getByPlaceholderText('输入人物名称');fireEvent.change(input,{target:{value:'林月尚未保存的修改'}});
 expect((input as HTMLInputElement).value).toBe('林月尚未保存的修改');
 api.setNodeStatus.mockResolvedValue(structuredClone(data));await act(async()=>{await useAppStore.getState().setNodeStatus('c','draft')});
 expect((input as HTMLInputElement).value).toBe('林月尚未保存的修改')
})
it('复制当前章节前应该保存编辑器中未落盘的新正文',async()=>{
 useAppStore.getState().updateContent('最新尚未落盘的正文');api.stats.mockResolvedValue(useAppStore.getState().stats);api.copyNode.mockResolvedValue(structuredClone(data));api.saveDocument.mockResolvedValue({node,content:'最新尚未落盘的正文'});
 await useAppStore.getState().copyNode('c','v','副本');
 expect(api.saveDocument).toHaveBeenCalled();expect(api.saveDocument.mock.invocationCallOrder[0]).toBeLessThan(api.copyNode.mock.invocationCallOrder[0])
})

it('保存失败时不创建章节副本', async () => {
 useAppStore.getState().updateContent('尚未保存');api.saveDocument.mockRejectedValueOnce(new Error('磁盘不可写'));
 await expect(useAppStore.getState().copyNode('c','v','副本')).rejects.toThrow('已取消复制');
 expect(api.copyNode).not.toHaveBeenCalled();expect(useAppStore.getState().document?.content).toBe('尚未保存')
})
it('刷新时保留未变化资料的引用，同时更新真正修改的资料', async () => {
 const current=useAppStore.getState().data!.entities[0];
 await useAppStore.getState().refreshData({...structuredClone(data),entities:[structuredClone(entity),{...entity,id:'new',title:'新资料'}]});
 expect(useAppStore.getState().data!.entities[0]).toBe(current);
 await useAppStore.getState().refreshData({...structuredClone(data),entities:[{...entity,title:'显式保存后的新名称'}]});
 expect(useAppStore.getState().data!.entities[0].title).toBe('显式保存后的新名称')
})
