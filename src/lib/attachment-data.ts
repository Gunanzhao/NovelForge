import type { EntityRecord, NodeRecord } from './types'

export function linkedAttachments(entities: EntityRecord[], nodes: NodeRecord[], nodeId?: string) {
  const node = nodes.find(item => item.id === nodeId)
  const chapterId = node?.kind === 'section' ? node.parentId : node?.kind === 'chapter' ? node.id : null
  return chapterId ? entities.filter(entity => entity.kind === 'attachment' && entity.content.chapterId === chapterId) : []
}

export function attachmentContextText(entity: EntityRecord) {
  const description = typeof entity.content.description === 'string' ? entity.content.description : ''
  return `附件：${entity.title}\n说明：${description || '未填写说明'}`
}
