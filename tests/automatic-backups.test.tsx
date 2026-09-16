import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AutoBackupStatus } from '../src/lib/auto-backup-types'
import type { ProjectData } from '../src/lib/types'
const api=vi.hoisted(()=>({autoBackupStatus:vi.fn(),runAutoBackup:vi.fn(),configureAutoBackup:vi.fn(),cleanupAutoBackups:vi.fn(),listRecovery:vi.fn(),readRecovery:vi.fn(),recoveryAsChapter:vi.fn()}))
vi.mock('../src/lib/api',()=>({isDesktop:true,projectApi:api,chooseDirectory:vi.fn()}))
import { useAutomaticBackups, runAutomaticBackup, useAutoBackup } from '../src/lib/automatic-backups'
import { AutoBackupSettings } from '../src/components/AutoBackupSettings'
import { RecoveryCenter } from '../src/components/RecoveryCenter'
import { captureProjectSession, useAppStore } from '../src/stores/app-store'
const data:ProjectData={project:{id:'p',formatVersion:1,title:'测试',author:'',description:'',genre:'',targetWords:1,createdAt:'',updatedAt:''},nodes:[{id:'volume',kind:'volume',title:'第一卷',parentId:null,status:'draft',filePath:'v',orderIndex:0,createdAt:'',updatedAt:''}],entities:[],recovery:[]}
const status:AutoBackupStatus={settings:{enabled:true,directory:'D:/backups',trigger:'session',keep:1,lastAttempt:null,lastSuccess:null,lastError:null,lastFingerprint:null,archives:[]},cleanup:[],availableBytes:1_000_000,message:''}
beforeEach(()=>{vi.clearAllMocks();useAppStore.setState({...useAppStore.getInitialState(),projectPath:'project',projectSession:1,data,document:null,saveState:'saved'});useAutoBackup.setState({path:'project',status:null,busy:false,error:''});api.autoBackupStatus.mockResolvedValue(status);api.runAutoBackup.mockResolvedValue(status);api.listRecovery.mockResolvedValue([])})
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks()})
it('runs only after a saved idle interval and postpones after editing',async()=>{
  vi.useFakeTimers();renderHook(()=>useAutomaticBackups());await act(async()=>{})
  await act(async()=>vi.advanceTimersByTimeAsync(90_000));expect(api.runAutoBackup).not.toHaveBeenCalled()
  act(()=>useAppStore.setState({documentVersion:1}))
  await act(async()=>vi.advanceTimersByTimeAsync(90_000));expect(api.runAutoBackup).not.toHaveBeenCalled()
  await act(async()=>vi.advanceTimersByTimeAsync(30_000));expect(api.runAutoBackup).toHaveBeenCalledTimes(1)
})
it('deduplicates simultaneous automatic runs and ignores results from previous projects',async()=>{
  let done!:(value:AutoBackupStatus)=>void;api.runAutoBackup.mockImplementation(()=>new Promise(resolve=>{done=resolve}))
  const session=captureProjectSession(),first=runAutomaticBackup(session),second=runAutomaticBackup(session)
  expect(api.runAutoBackup).toHaveBeenCalledTimes(1)
  useAppStore.setState({projectPath:'other',projectSession:2});useAutoBackup.setState({path:'other',status:null,busy:false})
  done(status);await Promise.all([first,second]);expect(useAutoBackup.getState().path).toBe('other');expect(useAutoBackup.getState().status).toBeNull()
})
it('requires a visible cleanup preview before invoking deletion',async()=>{
  const archive={id:'old',path:'D:/backups/old.nfbackup',createdAt:'2026-09-01T00:00:00Z',bytes:100,sha256:'abc'}
  api.autoBackupStatus.mockResolvedValue({...status,cleanup:[archive],settings:{...status.settings,archives:[archive]}});api.cleanupAutoBackups.mockResolvedValue(status)
  render(<AutoBackupSettings projectPath="project" />)
  await screen.findByRole('button',{name:'预览旧备份清理（1份）'})
  expect(screen.queryByRole('button',{name:'确认删除预览中的旧备份'})).toBeNull();expect(api.cleanupAutoBackups).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'预览旧备份清理（1份）'}));fireEvent.click(screen.getByRole('button',{name:'确认删除预览中的旧备份'}))
  await waitFor(()=>expect(api.cleanupAutoBackups).toHaveBeenCalledWith({projectPath:'project',archiveIds:['old']}))
})
it('retains directory and policy edits when unrelated backup status refreshes',async()=>{
  render(<AutoBackupSettings projectPath="project" />);await waitFor(()=>expect((screen.getByLabelText('建议保留份数') as HTMLInputElement).value).toBe('1'))
  fireEvent.change(screen.getByLabelText('建议保留份数'),{target:{value:'8'}})
  act(()=>useAutoBackup.setState({status:{...status,message:'刷新完成'}}))
  expect((screen.getByLabelText('建议保留份数') as HTMLInputElement).value).toBe('8')
})
it('orphan recovery can be read and saved as a new chapter with stable retry identity',async()=>{
  api.listRecovery.mockResolvedValue([{id:'missing--now.md',nodeId:'missing',nodeTitle:'原章节不可用',createdAt:'now',path:'r.md'}]);api.readRecovery.mockResolvedValue('需保留的孤立稿件');api.recoveryAsChapter.mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValue(data)
  render(<RecoveryCenter projectPath="project" />);await screen.findByRole('option',{name:/原章节不可用/})
  fireEvent.change(screen.getByLabelText('待处理恢复稿'),{target:{value:'missing--now.md'}});await screen.findByLabelText('恢复稿内容')
  fireEvent.change(screen.getByLabelText('另存到卷'),{target:{value:'volume'}});fireEvent.click(screen.getByRole('button',{name:'另存为新章节'}));await screen.findByRole('alert')
  const first=api.recoveryAsChapter.mock.calls[0][0];expect(first.expectedContent).toBe('需保留的孤立稿件')
  fireEvent.click(screen.getByRole('button',{name:'另存为新章节'}));await waitFor(()=>expect(api.recoveryAsChapter).toHaveBeenCalledTimes(2));expect(api.recoveryAsChapter.mock.calls[1][0].requestId).toBe(first.requestId)
})
it('ignores recovery content arriving after selecting another draft',async()=>{
  api.listRecovery.mockResolvedValue([{id:'a.md',nodeId:'a',nodeTitle:'稿件A',createdAt:'',path:''},{id:'b.md',nodeId:'b',nodeTitle:'稿件B',createdAt:'',path:''}]);let done!:(value:string)=>void;api.readRecovery.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve})).mockResolvedValueOnce('B正文')
  render(<RecoveryCenter projectPath="project" />);await screen.findByRole('option',{name:/稿件A/})
  fireEvent.change(screen.getByLabelText('待处理恢复稿'),{target:{value:'a.md'}});fireEvent.change(screen.getByLabelText('待处理恢复稿'),{target:{value:'b.md'}});await screen.findByLabelText('恢复稿内容')
  await act(async()=>done('A正文'));expect((screen.getByLabelText('恢复稿内容') as HTMLTextAreaElement).value).toBe('B正文')
})
