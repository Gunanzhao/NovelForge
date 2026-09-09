import { buildNameTrie, scanAutoNames } from './auto-names'
import { protectedMarkdownRanges } from './markdown-protected-ranges'
import type { EntityRecord } from './types'
let trie = buildNameTrie([]), source = '', blocked: ReturnType<typeof protectedMarkdownRanges> = []
self.onmessage = (event: MessageEvent<{ entities?: EntityRecord[]; id: number; source?: string; visible: {from:number;to:number}[] }>) => {
  const message = event.data
  if (message.entities) { trie = buildNameTrie(message.entities); return }
  if (message.source !== undefined && message.source !== source) { source = message.source; blocked = protectedMarkdownRanges(source) }
  self.postMessage({ id: message.id, matches: scanAutoNames(source,trie,message.visible,blocked) })
}
