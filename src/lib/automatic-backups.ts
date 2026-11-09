import { useEffect } from 'react'
import { create } from 'zustand'
import { isDesktop, projectApi } from './api'
import { busyDrafts, dirtyDrafts } from './draft-guard'
import { captureProjectSession, isCurrentProjectSession, useAppStore, type ProjectSession } from '../stores/app-store'
import type { AutoBackupStatus } from './auto-backup-types'
export const useAutoBackup = create<{path:string|null;status:AutoBackupStatus|null;busy:boolean;error:string}>(()=>({path:null,status:null,busy:false,error:''}))
const running = new Map<string, Promise<AutoBackupStatus | undefined>>()

function savedBody() {
  const { document, saveState } = useAppStore.getState()
  return !document || (saveState === 'saved' && document.content === document.persistedContent)
}

async function runProjectBackup(session: ProjectSession, manual: boolean) {
  if (!isDesktop || !session.path || !isCurrentProjectSession(session) || dirtyDrafts().length || busyDrafts()) return
  if (!savedBody()) return
  const path = session.path
  const existing = running.get(path)
  if (existing) return existing
  useAutoBackup.setState({ path, busy: true })
  const work = (async () => {
    try {
      const status = await projectApi.runAutoBackup({ projectPath: path, manual })
      if (isCurrentProjectSession(session)) useAutoBackup.setState({ path, status, error: status.settings.lastError ?? '' })
      return status
    } catch (error) {
      if (isCurrentProjectSession(session)) useAutoBackup.setState({ path, error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  })()
  running.set(path, work)
  try { return await work }
  finally {
    running.delete(path)
    if (isCurrentProjectSession(session)) useAutoBackup.setState({ busy: false })
  }
}

export function runAutomaticBackup(session: ProjectSession = captureProjectSession()) {
  return runProjectBackup(session, false)
}

export async function retryIndependentBackup(session: ProjectSession = captureProjectSession()) {
  if (!isDesktop || !session.path || !isCurrentProjectSession(session)) return
  if (dirtyDrafts().length || busyDrafts()) throw new Error('请先保存当前表单，再重试备份。')
  if (!savedBody() && !await useAppStore.getState().saveCurrentDocument('独立备份前保存')) {
    throw new Error('正文未能保存，请先处理保存问题，再重试备份。')
  }
  if (!isCurrentProjectSession(session)) return
  if (!savedBody() || dirtyDrafts().length || busyDrafts()) throw new Error('当前还有修改，请保存后再重试备份。')
  return runProjectBackup(session, true)
}

export async function refreshBackupStatus(session: ProjectSession = captureProjectSession()) {
  if (!isDesktop || !session.path || !isCurrentProjectSession(session)) return
  const path = session.path
  const snapshot = useAutoBackup.getState()
  const current = () => isCurrentProjectSession(session) && useAutoBackup.getState() === snapshot
  try {
    const status = await projectApi.autoBackupStatus(path)
    if (current()) useAutoBackup.setState({ path, status, error: status.settings.lastError ?? '' })
  } catch (error) {
    if (current()) useAutoBackup.setState({ path, error: error instanceof Error ? error.message : String(error) })
  }
}

export function useAutomaticBackups() {
  const path=useAppStore(state=>state.projectPath),session=useAppStore(state=>state.projectSession)
  useEffect(()=>{
    useAutoBackup.setState({path,status:null,busy:false,error:''})
    if(!isDesktop||!path)return
    const captured=captureProjectSession()
    let lastChange=Date.now(),nextCheck=0
    const unsubscribe=useAppStore.subscribe((state,previous)=>{if(state.documentVersion!==previous.documentVersion||state.data!==previous.data)lastChange=Date.now()})
    void refreshBackupStatus(captured)
    const timer=window.setInterval(()=>{
      if(Date.now()-lastChange<120_000||Date.now()<nextCheck)return
      nextCheck=Date.now()+300_000
      void runAutomaticBackup(captured)
    },30_000)
    return()=>{window.clearInterval(timer);unsubscribe()}
  },[path,session])
}
