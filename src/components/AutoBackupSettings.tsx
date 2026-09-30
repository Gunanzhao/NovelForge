import { useEffect, useRef, useState } from 'react'
import { chooseDirectory, isDesktop, projectApi } from '../lib/api'
import { useAutoBackup } from '../lib/automatic-backups'
import { busyDrafts, dirtyDrafts } from '../lib/draft-guard'
import type { AutoBackupStatus } from '../lib/auto-backup-types'
import { captureProjectSession, isCurrentProjectSession, useAppStore } from '../stores/app-store'
import { Button, Field, Panel, TextInput } from './ui'
const size=(bytes:number|null)=>bytes===null?'暂不可读取':(bytes/1024/1024).toLocaleString(undefined,{maximumFractionDigits:1})+' MB'
export function AutoBackupSettings({projectPath}:{projectPath:string}) {
  const shared=useAutoBackup(state=>state.path===projectPath?state.status:null)
  const running=useAutoBackup(state=>state.path===projectPath&&state.busy)
  const saved=useAppStore(state=>state.saveState)
  const [settings,setSettings]=useState({enabled:false,directory:'',trigger:'daily' as 'daily'|'session',keep:10})
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [preview,setPreview]=useState<string[]|null>(null),[restored,setRestored]=useState('')
  const pending=useRef(false),generation=useRef(0)
  useEffect(()=>{
    const request=++generation.current
    if (!isDesktop) return
    void projectApi.autoBackupStatus(projectPath).then(status=>{if(generation.current!==request)return;setSettings(status.settings);useAutoBackup.setState({path:projectPath,status,error:status.settings.lastError??''})}).catch(error=>{if(generation.current===request)setError(String(error))})
    return()=>{generation.current=request+1}
  },[projectPath])
  function publish(status:AutoBackupStatus){useAutoBackup.setState({path:projectPath,status,error:status.settings.lastError??''});setNotice(status.message);setPreview(null)}
  async function act(mode:'save'|'run'|'cleanup'|'restore',path?:string){
    if(pending.current||running||busyDrafts())return
    const session=captureProjectSession(),request=generation.current
    if(session.path!==projectPath)return
    const current=()=>generation.current===request&&isCurrentProjectSession(session)
    pending.current=true;setBusy(true);setError('');setNotice('')
    try {
      if(mode==='restore'){
        const directory=await chooseDirectory();if(!directory||!current())return
        const result=await projectApi.restoreBackup(path!,directory);if(current()){setRestored(result.path);setNotice('备份已校验并恢复到新目录。')}
      } else if(mode==='save'){
        const result=await projectApi.configureAutoBackup({projectPath,...settings});if(current())publish(result)
      } else if(mode==='run'){
        if(dirtyDrafts().length)throw new Error('请先保存资料表单。')
        if(!await useAppStore.getState().saveCurrentDocument('独立备份前保存')||!current())return
        const result=await projectApi.runAutoBackup({projectPath,manual:true});if(current())publish(result)
      } else {
        if(!preview?.length)return
        const result=await projectApi.cleanupAutoBackups({projectPath,archiveIds:preview});if(current())publish(result)
      }
    }catch(error){if(current())setError(String(error))}
    finally{pending.current=false;if(current())setBusy(false)}
  }
  async function choose(){const session=captureProjectSession();try{const directory=await chooseDirectory();if(directory&&isCurrentProjectSession(session))setSettings(previous=>({...previous,directory}))}catch(error){if(isCurrentProjectSession(session))setError(String(error))}}
  if(!isDesktop)return null
  return <Panel className="settings-card automatic-backup-settings"><h2>自动备份与恢复中心</h2>
    <div className="backup-health"><div><strong>正文保存</strong><span>{saved==='saved'?'当前正文已保存':saved==='saving'?'正在保存':saved==='error'?'保存失败':'有待保存内容'}</span></div><div><strong>项目内历史</strong><span>正文快照与资料版本保存在当前项目内</span></div><div><strong>独立目录备份</strong><span>{running?'正在备份…':shared?.settings.lastSuccess?'最近成功：'+new Date(shared.settings.lastSuccess).toLocaleString():'尚无自动备份成功记录'}</span></div></div>
    <p className="field-hint">独立备份需选择项目之外的文件夹。每日模式每天最多自动创建一次；会话模式在停止编辑两分钟后或关闭项目/窗口前检查。内容未变化时跳过。设置只保存在本机当前项目中。</p>
    <div className="automatic-backup-form" inert={busy||running}>
      <label className="entity-history-field"><input type="checkbox" checked={settings.enabled} onChange={event=>setSettings(previous=>({...previous,enabled:event.target.checked}))} />启用自动备份</label>
      <Field label="独立备份目录"><div className="input-with-action"><TextInput value={settings.directory} readOnly placeholder="尚未选择" /><Button variant="outline" onClick={()=>void choose()}>选择目录</Button></div></Field>
      <div className="backup-policy-grid"><Field label="自动触发"><select className="select-input" value={settings.trigger} onChange={event=>setSettings(previous=>({...previous,trigger:event.target.value as 'daily'|'session'}))}><option value="daily">每日一次</option><option value="session">写作会话暂停或结束</option></select></Field><Field label="建议保留份数"><TextInput type="number" min={1} max={100} value={settings.keep} onChange={event=>setSettings(previous=>({...previous,keep:Number(event.target.value)}))} /></Field></div>
      <div className="backup-actions"><Button onClick={()=>void act('save')} disabled={!Number.isInteger(settings.keep)||settings.keep<1||settings.keep>100}>保存备份设置</Button><Button variant="outline" disabled={!shared?.settings.directory} onClick={()=>void act('run')}>立即检查并备份</Button></div>
    </div>
    <p className="field-hint">目录可用空间：{size(shared?.availableBytes??null)}。超出保留份数时先预览，由你确认清理。</p>
    {(error||shared?.settings.lastError)&&<p role="alert">{error||shared?.settings.lastError}</p>}{notice&&<p role="status">{notice}</p>}
    {shared?.cleanup.length?<div className="backup-cleanup"><Button variant="outline" disabled={busy||running} onClick={()=>setPreview(shared.cleanup.map(archive=>archive.id))}>预览旧备份清理（{shared.cleanup.length}份）</Button>{preview&&<><ul>{shared.cleanup.filter(archive=>preview.includes(archive.id)).map(archive=><li key={archive.id}><code>{archive.path}</code><span>{size(archive.bytes)}</span></li>)}</ul><Button variant="danger" disabled={busy||running} onClick={()=>void act('cleanup')}>确认删除预览中的旧备份</Button><Button variant="ghost" disabled={busy} onClick={()=>setPreview(null)}>取消清理</Button></>}</div>:null}
    {shared?.settings.archives.length?<details className="backup-archive-list"><summary>已登记的独立备份（{shared.settings.archives.length}份）</summary>{[...shared.settings.archives].reverse().map(archive=><div className="backup-archive" key={archive.id}><span><strong>{new Date(archive.createdAt).toLocaleString()} · {size(archive.bytes)}</strong><code>{archive.path}</code></span><Button variant="outline" disabled={busy||running} onClick={()=>void act('restore',archive.path)}>校验并恢复到新目录</Button></div>)}</details>:null}
    {restored&&<div className="backup-result"><code>{restored}</code><Button disabled={busy||running} onClick={()=>void useAppStore.getState().openProject(restored).catch(error=>setError(String(error)))}>打开恢复项目</Button></div>}
  </Panel>
}
