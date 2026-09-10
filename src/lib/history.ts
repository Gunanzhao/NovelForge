import { isNodeLocked } from './node-lock'
import { projectApi } from './api'
import { useAppStore } from '../stores/app-store'

const protectedOperations = new Set<string>()
const pending = new Map<string, Promise<void>>()
export function historyChanged() { window.dispatchEvent(new Event('novelforge:history-changed')) }

// A snapshot must reach storage before a destructive change is allowed into the editor.
export async function protectBeforeChange(source: string, name: string, operationId?: string) {
  const state = useAppStore.getState()
  if (!state.projectPath || !state.document || state.document.content !== source) throw new Error('正文已变化，请重试操作。')
  const nodeId = state.document.node.id
  if (isNodeLocked(state.data?.nodes ?? [], nodeId)) throw new Error('正文已锁定，无法应用修改。')
  const valid = () => {
    const current = useAppStore.getState()
    return current.projectPath === state.projectPath && current.projectSession === state.projectSession && current.document?.node.id === nodeId && current.document.content === source
  }
  const key = operationId ? JSON.stringify([state.projectPath, state.projectSession, nodeId, operationId]) : null
  if (!key || !protectedOperations.has(key)) {
    let request = key ? pending.get(key) : undefined
    if (!request) {
      request = projectApi.createHistorySnapshot({ projectPath: state.projectPath, nodeId, content: source, kind: 'protected', name })
      if (key) pending.set(key, request)
    }
    try { await request } finally { if (key) pending.delete(key) }
    if (!valid()) throw new Error('保存保护版本期间正文或章节已变化，操作已取消。')
    if (key) {
      protectedOperations.add(key)
      if (protectedOperations.size > 100) protectedOperations.delete(protectedOperations.values().next().value!)
    }
    historyChanged()
  }
  if (!valid()) throw new Error('正文已变化，操作已取消。')
}
