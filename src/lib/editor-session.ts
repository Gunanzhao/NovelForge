export interface EditorPosition { anchor: number; head: number; scrollTop: number; scrollLeft: number }
interface Session { nodeId: string; positions: Record<string, EditorPosition> }
const memory = new Map<string, Session>()
const key = (path: string) => 'novelforge:editor-session:' + path.replaceAll('\\', '/').toLocaleLowerCase()
export function readEditorSession(path: string): Session {
  const id = key(path)
  if (memory.has(id)) return memory.get(id)!
  try { const value = JSON.parse(localStorage.getItem(id) ?? 'null'); if (value && typeof value.nodeId === 'string' && value.positions && typeof value.positions === 'object') { memory.set(id, value); return value } } catch { /* Position recovery is best effort. */ }
  return { nodeId: '', positions: {} }
}
export function rememberEditor(path: string, nodeId: string, position?: EditorPosition) {
  const previous = readEditorSession(path)
  const positions = { ...previous.positions }
  if (position) { delete positions[nodeId]; positions[nodeId] = position }
  const value = { nodeId, positions: Object.fromEntries(Object.entries(positions).slice(-100)) }
  memory.set(key(path), value)
  try { localStorage.setItem(key(path), JSON.stringify(value)) } catch { /* Keep the position in this process if storage is unavailable. */ }
}
export function clampEditorPosition(value: EditorPosition | undefined, length: number): EditorPosition {
  const safe = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0
  return { anchor: safe(value?.anchor, length), head: safe(value?.head, length), scrollTop: safe(value?.scrollTop, 1e8), scrollLeft: safe(value?.scrollLeft, 1e8) }
}
