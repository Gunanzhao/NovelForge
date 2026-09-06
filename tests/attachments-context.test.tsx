import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EntityRecord,NodeRecord,ProjectData} from '../src/lib/types'
vi.mock('../src/lib/api',()=>({isDesktop:false,chooseFile:vi.fn(),projectApi:{getDocument:vi.fn(),openAttachment:vi.fn()}}))
vi.mock('../src/components/ContextMenu',()=>({useContextMenu:()=>({openContextMenu:vi.fn()})}))
import {AttachmentsView} from '../src/components/AttachmentsView'
import {AiAssistantView} from '../src/components/AiAssistantView'
import {attachmentContextText,linkedAttachments} from '../src/lib/attachment-data'
import {contextItems} from '../src/lib/ai-data'
import {useAppStore} from '../src/stores/app-store'
const chapter:NodeRecord={id:'c',kind:'chapter',parentId:'v',title:'测试章',filePath:'c.md',status:'draft',orderIndex:0,createdAt:'',updatedAt:''}
const section:NodeRecord={...chapter,id:'s',parentId:'c',kind:'section',filePath:'c/s.md'}
const attachment:EntityRecord={id:'a',kind:'attachment',title:'参考资料.txt',filePath:'attachments/a.txt',content:{chapterId:'c',description:'用于核对城市设定的说明',sourcePath:'PRIVATE_SOURCE_MUST_NOT_SEND',rawBytes:'BINARY_MUST_NOT_SEND'},tags:[],createdAt:'',updatedAt:''}
const other:EntityRecord={...attachment,id:'b',title:'另一个章节的附件.txt',content:{chapterId:'other',description:'其他章节'}}
const data:ProjectData={project:{id:'p',formatVersion:1,title:'测试',author:'',description:'',genre:'',targetWords:0,createdAt:'',updatedAt:''},nodes:[chapter,section],entities:[attachment,other],recovery:[]}
beforeEach(()=>{localStorage.clear();useAppStore.setState({...useAppStore.getInitialState(),projectPath:'P',data,document:{node:chapter,content:'测试正文'},saveState:'saved',selectedEntityId:'a'})})
afterEach(cleanup)
it('从章节链接打开正确附件，筛选无匹配时不保留旧详情操作',()=>{
 render(<AttachmentsView/>);expect(screen.getByRole('button',{name:'打开文件'})).toBeTruthy();
 fireEvent.change(screen.getByPlaceholderText('搜索附件名称或说明'),{target:{value:'完全没有匹配'}});
 expect(screen.getByText('没有匹配附件')).toBeTruthy();expect(screen.queryByRole('button',{name:'打开文件'})).toBeNull();
 fireEvent.change(screen.getByPlaceholderText('搜索附件名称或说明'),{target:{value:'另一个章节'}});
 expect(screen.getByRole('button',{name:'打开文件'})).toBeTruthy()
})
it('章节及其小节展示同一组关联附件，切换章节不会包含其他附件',()=>{
 expect(linkedAttachments(data.entities,data.nodes,'s')).toEqual([attachment]);
 expect(linkedAttachments(data.entities,data.nodes,'missing')).toEqual([]);
 expect(contextItems(data.nodes,data.entities,'s').filter(item=>item.id==='a')).toHaveLength(1);
 expect(contextItems(data.nodes,data.entities,'s').some(item=>item.id==='b')).toBe(false);
 expect(attachmentContextText(attachment)).toContain(attachment.content.description);
 expect(attachmentContextText(attachment)).not.toContain('PRIVATE_SOURCE');expect(attachmentContextText(attachment)).not.toContain('BINARY')
})
it('AI预览真实展开所选附件说明文本，不隐式发送文件内容',async()=>{
 render(<AiAssistantView/>);
 fireEvent.click(screen.getByRole('checkbox',{name:/参考资料.txt/}));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'预览上下文'}))});
 await waitFor(()=>expect([...document.querySelectorAll('.ai-preview-panel pre')].map(e=>e.textContent).join('')).toContain('用于核对城市设定的说明'));
 const preview=document.querySelector('.ai-preview-panel')!.textContent!;expect(preview).not.toContain('PRIVATE_SOURCE');expect(preview).not.toContain('BINARY');
 expect(screen.queryByRole('checkbox',{name:/另一个章节的附件/})).toBeNull()
})