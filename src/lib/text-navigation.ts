import { create } from 'zustand'
import { captureProjectSession, isCurrentProjectSession, useAppStore, type ProjectSession } from '../stores/app-store'
export interface TextJump {session:ProjectSession;nodeId:string;from:number;to:number;content:string}
export const useTextNavigation=create<{request:TextJump|null}>(()=>({request:null}))
export async function jumpToText(nodeId:string,content:string,from:number,to:number){
  const session=captureProjectSession()
  await useAppStore.getState().selectNode(nodeId)
  const state=useAppStore.getState()
  if(!isCurrentProjectSession(session)||state.document?.node.id!==nodeId||state.document.content!==content)throw new Error('正文已变化，请刷新后重新定位')
  if(from<0||to<from||to>content.length)throw new Error('定位范围无效')
  state.setEditorMode('markdown')
  useTextNavigation.setState({request:{session,nodeId,content,from,to}})
}
