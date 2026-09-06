import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
const api=vi.hoisted(()=>({openExternalUrl:vi.fn(async()=>{})}))
vi.mock('../src/lib/api',()=>({isDesktop:true,projectApi:api}))
import {MarkdownPreview} from '../src/components/MarkdownPreview'
import {useAppStore} from '../src/stores/app-store'
import {fitWorkspaceColumns,DEFAULT_WORKSPACE_PREFERENCES,readWorkspacePreferences} from '../src/lib/workspace-preferences'
beforeEach(()=>{vi.clearAllMocks();useAppStore.setState(useAppStore.getInitialState())})
afterEach(cleanup)
it('外链由原生命令交给浏览器而不导航工作台，Wiki仍在项目中处理',async()=>{
 const wiki=vi.fn();render(<MarkdownPreview markdown={'[外链](https://example.com) [[林月]] [脚注](#user-content-fn-1)'} onWikiLink={wiki}/>);
 const click=new MouseEvent('click',{bubbles:true,cancelable:true});screen.getByRole('link',{name:'外链'}).dispatchEvent(click);
 expect(click.defaultPrevented).toBe(true);await waitFor(()=>expect(api.openExternalUrl).toHaveBeenCalledWith('https://example.com'));
 fireEvent.click(screen.getByRole('link',{name:'林月（未建档）'}));expect(wiki).toHaveBeenCalledWith('林月');
 const anchor=new MouseEvent('click',{bubbles:true,cancelable:true});screen.getByRole('link',{name:'脚注'}).dispatchEvent(anchor);expect(anchor.defaultPrevented).toBe(false)
})
it('原生打开失败不会清空工作区而是显示错误',async()=>{
 api.openExternalUrl.mockRejectedValueOnce(new Error('浏览器无法打开'));render(<MarkdownPreview markdown={'[外链](https://example.com)'} onWikiLink={()=>{}}/>);
 fireEvent.click(screen.getByRole('link',{name:'外链'}));await waitFor(()=>expect(useAppStore.getState().error).toContain('浏览器无法打开'));expect(screen.getByRole('link',{name:'外链'})).toBeTruthy()
})
it('实时拖拽和保存的宽度使用同一归一化规则',()=>{
 useAppStore.getState().setWorkspacePreferences({sidebarWidth:1222,inspectorWidth:-500});
 const p=useAppStore.getState().workspacePreferences;expect(p.sidebarWidth).toBe(420);expect(p.inspectorWidth).toBe(220);expect(readWorkspacePreferences()).toEqual(p)
})
it.each([1100,1366,1440])('在 %i 视口和最大侧栏组合下保留中央工作区',width=>{
 const preferences={...DEFAULT_WORKSPACE_PREFERENCES,sidebarWidth:420,inspectorWidth:420};
 for(const left of [false,true])for(const right of [false,true]){
  const fit=fitWorkspaceColumns(preferences,width,left,right);expect(width-fit.sidebar-fit.inspector).toBeGreaterThanOrEqual(480);
  if(!left)expect(fit.sidebar).toBe(0);if(!right)expect(fit.inspector).toBe(0)
 }
})