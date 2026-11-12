import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChapterMemoryView } from '../src/components/ChapterMemoryView'
import { projectApi } from '../src/lib/api'
import { blankMemoryFields, useMemoryImport } from '../src/lib/chapter-memory'
import { contextItems } from '../src/lib/ai-data'
import { useAppStore } from '../src/stores/app-store'
afterEach(()=>{cleanup();vi.restoreAllMocks();useMemoryImport.setState({draft:null})})
it('refreshes queue status from disk even when the editor still holds older saved text', async () => {
  const { path, node, source } = await fixture()
  render(<ChapterMemoryView />)
  const queue = within(screen.getByRole('complementary', { name: '记忆来源章节' }))
  await queue.findByRole('button', { name: '第一章 待确认' })
  await projectApi.saveDocument({ projectPath: path, nodeId: node.id, content: source + '外部续写。', reason: '模拟另一处编辑' })
  fireEvent.click(screen.getByRole('button', { name: '刷新记忆状态' }))
  await queue.findByRole('button', { name: '第一章 已过期' })
})
it('filters the queue and advances to stale memory without auto-confirming it', async () => {
  const { path, node, source } = await fixture()
  let data = await projectApi.createNode({ projectPath: path, kind: 'chapter', parentId: node.parentId, title: '第二章 灯塔' })
  const second = data.nodes.find(item => item.title === '第二章 灯塔')!
  await projectApi.saveDocument({ projectPath: path, nodeId: second.id, content: source + '后来门开了。', reason: '过期来源' })
  data = await projectApi.upsertEntity({ projectPath: path, id: 'stale-memory', kind: 'chapter-memory', title: '灯塔记忆', tags: [], content: { chapterId: second.id, sourceText: source, ...blankMemoryFields(), summary: '旧摘要', status: 'confirmed', sources: [{ id: 's', field: 'summary', from: 0, to: 7, quote: '林月拿到钥匙。' }] } })
  useAppStore.setState({ data })
  render(<ChapterMemoryView />)
  const queue = within(screen.getByRole('complementary', { name: '记忆来源章节' }))
  await queue.findByRole('button', { name: '第二章 灯塔 已过期' })
  fireEvent.click(screen.getByRole('button', { name: '下一份待确认／过期记忆' }))
  await waitFor(() => expect((screen.getByLabelText('章节摘要') as HTMLTextAreaElement).value).toBe('旧摘要'))
  expect((screen.getByRole('button', { name: '确认这份章节记忆' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('记忆状态'), { target: { value: 'draft' } })
  expect(queue.queryByRole('button', { name: /第二章/ })).toBeNull()
  expect(queue.getByRole('button', { name: '第一章 待确认' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('搜索记忆章节'), { target: { value: '不存在' } })
  expect(queue.getByText('没有符合筛选的章节。')).toBeTruthy()
  expect((screen.getByLabelText('章节摘要') as HTMLTextAreaElement).value).toBe('旧摘要')
})
async function fixture(withMemory=true){const path='memory-view-'+crypto.randomUUID();let data=await projectApi.create({path,title:'记忆测试',author:'',description:'',genre:'',targetWords:1});const node=data.nodes.find(node=>node.kind==='chapter')!;const source='林月拿到钥匙。她没有打开门。';const document=await projectApi.saveDocument({projectPath:path,nodeId:node.id,content:source,reason:'测试'});if(withMemory)data=await projectApi.upsertEntity({projectPath:path,id:'memory',kind:'chapter-memory',title:'第一章记忆',tags:[],content:{chapterId:node.id,sourceText:source,...blankMemoryFields(),summary:'林月取得钥匙',status:'draft',sources:[{id:'s',field:'summary',from:0,to:7,quote:'林月拿到钥匙。'}]}});useAppStore.setState({...useAppStore.getInitialState(),projectPath:path,data,document:{...document,persistedContent:source},saveState:'saved',activeView:'chapter-memory'});return{path,data,node,source,document}}
it('saves field edits as draft and only includes memory after explicit author confirmation',async()=>{
 const {source}=await fixture();render(<ChapterMemoryView/>);await screen.findByLabelText('关键事件');fireEvent.change(screen.getByLabelText('关键事件'),{target:{value:'林月取得钥匙但未开门'}});fireEvent.click(screen.getByRole('button',{name:'保存记忆草稿'}));await screen.findByText('草稿已保存；尚未纳入已确认记忆。');expect(useAppStore.getState().data!.entities.find(entity=>entity.id==='memory')!.content.status).toBe('draft')
 fireEvent.click(screen.getByRole('button',{name:'确认这份章节记忆'}));await screen.findByText('作者确认已保存。可在AI参考资料中勾选这份记忆。');const state=useAppStore.getState();expect(contextItems(state.data!.nodes,state.data!.entities,state.document!.node.id,source).some(item=>item.kind==='memory')).toBe(true)
})
it('marks changed manuscript stale and clears obsolete quotations when starting a new review',async()=>{
 const {document,source}=await fixture();render(<ChapterMemoryView/>);await screen.findByLabelText('章节摘要');act(()=>useAppStore.setState({document:{...document,content:source+'门已经打开。',persistedContent:source+'门已经打开。'}}));expect(screen.getByText(/当前正文与这份草稿的依据不同/)).toBeTruthy();expect((screen.getByRole('button',{name:'确认这份章节记忆'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'以当前正文重新核对'}));expect(screen.queryByRole('button',{name:'移除这处依据'})).toBeNull();expect((screen.getByLabelText('章节摘要') as HTMLTextAreaElement).value).toBe('林月取得钥匙')
})
it('imports complete AI output as unsaved draft rather than confirmed facts',async()=>{
 const {path,node,source}=await fixture(false);useMemoryImport.setState({draft:{projectPath:path,session:useAppStore.getState().projectSession,chapterId:node.id,sourceText:source,fields:{...blankMemoryFields(),summary:'AI待核对摘要'},sources:[]}});render(<StrictMode><ChapterMemoryView/></StrictMode>);await screen.findByText('完整AI结果已填入待审阅草稿，尚未保存或确认。');expect((screen.getByLabelText('章节摘要') as HTMLTextAreaElement).value).toBe('AI待核对摘要');expect(useAppStore.getState().data!.entities.some(entity=>entity.kind==='chapter-memory')).toBe(false);expect((screen.getByRole('button',{name:'确认这份章节记忆'}) as HTMLButtonElement).disabled).toBe(true)
})
it('records exactly the author-selected source passage',async()=>{
 await fixture(false);render(<ChapterMemoryView/>);await screen.findByLabelText('记忆依据原文');const text=screen.getByLabelText('记忆依据原文') as HTMLTextAreaElement;text.focus();text.setSelectionRange(0,7);fireEvent.select(text);fireEvent.click(screen.getByRole('button',{name:'添加所选原文依据'}));expect(screen.getByText('林月拿到钥匙。')).toBeTruthy();fireEvent.change(screen.getByLabelText('章节摘要'),{target:{value:'手写摘要'}});fireEvent.click(screen.getByRole('button',{name:'保存记忆草稿'}));await screen.findByText('草稿已保存；尚未纳入已确认记忆。');expect(useAppStore.getState().data!.entities.find(entity=>entity.kind==='chapter-memory')!.content.sources).toEqual([expect.objectContaining({from:0,to:7,quote:'林月拿到钥匙。'})])
})
it('refuses stale memory saves and retains the local author edits for review',async()=>{
 const {path,node,source}=await fixture();render(<ChapterMemoryView/>);await screen.findByLabelText('章节摘要');fireEvent.change(screen.getByLabelText('章节摘要'),{target:{value:'本地尚未保存的复核'}})
 await projectApi.upsertEntity({projectPath:path,id:'memory',kind:'chapter-memory',title:'第一章记忆',tags:[],content:{...blankMemoryFields(),chapterId:node.id,sourceText:source,summary:'另一处已保存的修改',status:'draft',sources:[]}})
 fireEvent.click(screen.getByRole('button',{name:'保存记忆草稿'}));await screen.findByRole('alert');expect((screen.getByLabelText('章节摘要') as HTMLTextAreaElement).value).toBe('本地尚未保存的复核')
})

it('maps textarea LF selections back to unchanged CRLF source offsets',async()=>{
 const {path,node}=await fixture(false)
 const source='# 章节\r\n林月拿到钥匙。\r\n后文'
 const doc=await projectApi.saveDocument({projectPath:path,nodeId:node.id,content:source,reason:'CRLF回归'})
 useAppStore.setState({document:{...doc,persistedContent:source}})
 render(<ChapterMemoryView/>);await screen.findByLabelText('记忆依据原文')
 const textarea=screen.getByLabelText('记忆依据原文') as HTMLTextAreaElement
 textarea.focus();const from=textarea.value.indexOf('林月');textarea.setSelectionRange(from,from+7);fireEvent.select(textarea)
 fireEvent.click(screen.getByRole('button',{name:'添加所选原文依据'}))
 expect(screen.getByText('林月拿到钥匙。')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('章节摘要'),{target:{value:'拿到钥匙'}})
 fireEvent.click(screen.getByRole('button',{name:'保存记忆草稿'}));await screen.findByText('草稿已保存；尚未纳入已确认记忆。')
 const entity=useAppStore.getState().data!.entities.find(item=>item.kind==='chapter-memory')!
 expect(entity.content.sourceText).toBe(source)
 expect(entity.content.sources).toEqual([expect.objectContaining({from:source.indexOf('林月'),to:source.indexOf('林月')+7,quote:'林月拿到钥匙。'})])
})
