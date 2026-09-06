import type { NodeRecord } from './types'

/** Locks protect a node's body and all descendant bodies. */
export function isNodeLocked(nodes: NodeRecord[], id: string | undefined): boolean {
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const node = nodes.find((item) => item.id === id)
    if (!node) return false
    if (node.status === 'locked') return true
    id = node.parentId ?? undefined
  }
  return false
}
