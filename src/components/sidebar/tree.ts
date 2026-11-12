import type { NodeRecord } from '../../lib/types'

/** Index once so rendering a long manuscript does not rescan every chapter per row. */
function childrenByParent(nodes: NodeRecord[]) {
  const children = new Map<string | null, NodeRecord[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.orderIndex - b.orderIndex)
  return children
}

export function flattenTree(
  nodes: NodeRecord[],
  volumes: NodeRecord[],
  openNodes: Set<string>,
) {
  const children = childrenByParent(nodes)
  const rows: Array<{ node: NodeRecord; level: number }> = []
  const visited = new Set<string>()
  const visit = (node: NodeRecord, level: number) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    rows.push({ node, level })
    if (openNodes.has(node.id))
      children.get(node.id)?.forEach((child) => visit(child, level + 1))
  }
  volumes.forEach((volume) => visit(volume, 0))
  return rows
}

/** A match keeps its ancestry and contents, so volume/chapter searches remain navigable. */
export function filterTreeByTitle(
  nodes: NodeRecord[],
  query: string,
): NodeRecord[] {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return nodes
  const children = childrenByParent(nodes)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const included = new Set<string>()
  const descendants = new Set<string>()
  const includeContents = (node: NodeRecord) => {
    if (descendants.has(node.id)) return
    descendants.add(node.id)
    included.add(node.id)
    children.get(node.id)?.forEach(includeContents)
  }
  for (const node of nodes) {
    if (!node.title.toLocaleLowerCase().includes(term)) continue
    includeContents(node)
    const ancestors = new Set<string>()
    let parent = node.parentId ? byId.get(node.parentId) : undefined
    while (parent && !ancestors.has(parent.id)) {
      ancestors.add(parent.id)
      included.add(parent.id)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
  }
  return nodes.filter((node) => included.has(node.id))
}
