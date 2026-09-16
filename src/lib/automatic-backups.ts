import { useEffect } from 'react'
import { create } from 'zustand'
import { isDesktop, projectApi } from './api'
import { busyDrafts, dirtyDrafts } from './draft-guard'
import { captureProjectSession, isCurrentProjectSession, useAppStore, type ProjectSession } from '../stores/app-store'
import type { AutoBackupStatus } from './auto-backup-types'
export const useAutoBackup = create<{path:string|null;status:AutoBackupStatus|null;busy:boolean;error:string}>(()=>({path:null,status:null,busy:false,error:''}))
const running=new Map<string,Promise<void>>()
export async function runAutomaticBackup(session:ProjectSession=captureProjectSession()) {
  if (!isDesktop || !session.path || !isCurrentProjectSession(session) || dirtyDrafts().length || busyDrafts()) return
  const state=useAppStore.getState()
  if (state.document && (state.saveState!=='saved' || state.document.content!==state.document.persistedContent)) return
  const path=session.path
  if (running.has(path)) return running.get(path)
  const work=(async()=>{
    if (isCurrentProjectSession(session)) useAutoBackup.setState({path,busy:true,error:''})
    try {
      const status=await projectApi.runAutoBackup({projectPath:path,manual:false})
      if (isCurrentProjectSession(session)) useAutoBackup.setState({path,status,error:status.settings.lastError ?? ''})
    } catch(error) {if(isCurrentProjectSession(session))useAutoBackup.setState({path,error:String(error)})}
    finally {running.delete(path);if(isCurrentProjectSession(session))useAutoBackup.setState({busy:false})}
  })()
  running.set(path,work);return work
}
export function useAutomaticBackups() {
  const path=useAppStore(state=>state.projectPath),session=useAppStore(state=>state.projectSession)
  useEffect(()=>{
    useAutoBackup.setState({path,status:null,busy:false,error:''})
    if(!isDesktop||!path)return
    const captured=captureProjectSession()
    let lastChange=Date.now(),nextCheck=0
    const unsubscribe=useAppStore.subscribe((state,previous)=>{if(state.documentVersion!==previous.documentVersion||state.data!==previous.data)lastChange=Date.now()})
    void projectApi.autoBackupStatus(path).then(status=>{if(isCurrentProjectSession(captured))useAutoBackup.setState({status,error:status.settings.lastError ?? ''})}).catch(error=>{if(isCurrentProjectSession(captured))useAutoBackup.setState({error:String(error)})})
    const timer=window.setInterval(()=>{
      if(Date.now()-lastChange<120_000||Date.now()<nextCheck)return
      nextCheck=Date.now()+300_000
      void runAutomaticBackup(captured)
    },30_000)
    return()=>{window.clearInterval(timer);unsubscribe()}
  },[path,session])
}
