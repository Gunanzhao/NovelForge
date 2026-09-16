import { markdownLanguage } from '@codemirror/lang-markdown'
import { wikiRanges } from './markdown'
import { protectedMarkdownRanges } from './markdown-protected-ranges'
import { entityState } from './entity-history'
import type { EntityRecord, EntityState, ProjectData } from './types'

type FieldPath = Array<string | number>
export interface RenameReference {
  id: string
  refKind: 'node' | 'entity'
  refId: string
  title: string
  fieldPath: FieldPath
  from: number
  to: number
  excerpt: string
}
export interface WikiRenamePlan {
  entity: EntityRecord
  newTitle: string
  ambiguous: boolean
  keepOldAlias: boolean
  references: RenameReference[]
  plainCandidates: RenameReference[]
  documents: Array<{ id: string; title: string; before: string }>
  entities: EntityRecord[]
}
export interface RenameChanges {
  documents: Array<{ id: string; before: string; after: string }>
  entities: Array<{ id: string; before: EntityState; after: EntityState }>
}
const nameKey = (value: string) => value.trim().toLocaleLowerCase()

function codeRanges(source: string) {
  const result: Array<{start: number; end: number}> = []
  markdownLanguage.parser.parse(source).iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Comment'].includes(node.name)) {
      result.push({ start: node.from, end: node.to }); return false
    }
  } })
  return result
}
function stringFields(value: unknown, path: FieldPath = []): Array<{path: FieldPath; text: string}> {
  if (typeof value === 'string') return [{ path, text: value }]
  if (Array.isArray(value)) return value.flatMap((item,index) => stringFields(item,[...path,index]))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key,item]) => stringFields(item,[...path,key]))
  return []
}
function scan(source: string, oldTitle: string, context: Omit<RenameReference, 'id' | 'from' | 'to' | 'excerpt'>) {
  const syntax = codeRanges(source)
  const overlaps = (from: number, to: number, spans: Array<{start:number;end:number}>) => spans.some(span => from < span.end && to > span.start)
  const location = (from: number,to: number): RenameReference => ({ ...context, from, to, id: JSON.stringify([context.refKind,context.refId,context.fieldPath,from,to]), excerpt: source.slice(Math.max(0,from-32),Math.min(source.length,to+32)) })
  const references = wikiRanges(source).filter(range => nameKey(range.target) === nameKey(oldTitle) && !overlaps(range.from,range.to,syntax)).map(range => location(range.from,range.to))
  const excluded = [...protectedMarkdownRanges(source),...syntax]
  const plainCandidates: RenameReference[] = []
  for (let from = source.indexOf(oldTitle); from >= 0; from = source.indexOf(oldTitle,from+oldTitle.length)) {
    const to = from+oldTitle.length
    const embeddedAscii = /^[A-Za-z0-9_]/u.test(oldTitle) && /[A-Za-z0-9_]/u.test(source[from-1] ?? '') || /[A-Za-z0-9_]$/u.test(oldTitle) && /[A-Za-z0-9_]/u.test(source[to] ?? '')
    if (!embeddedAscii && !overlaps(from,to,excluded)) plainCandidates.push(location(from,to))
  }
  return { references,plainCandidates }
}

export function planWikiRename(data: ProjectData, documents: Record<string,string>, entityId: string, title: string, keepOldAlias = true): WikiRenamePlan {
  const entity = data.entities.find(entity => entity.id === entityId)
  if (!entity) throw new Error('待改名资料不存在')
  const newTitle = title.trim()
  if (!newTitle || (newTitle.includes('[') || newTitle.includes(']') || /[\r\n]/u.test(newTitle))) throw new Error('新名称不能为空或包含方括号、换行')
  if (entity.title === newTitle) throw new Error('新名称与原名称相同')
  if (data.entities.some(other => other.id !== entityId && nameKey(other.title) === nameKey(newTitle))) throw new Error('新名称已被其他资料使用，请先处理同名资料')
  const plan: WikiRenamePlan = { entity: structuredClone(entity),newTitle,keepOldAlias,ambiguous:data.entities.some(other => other.id !== entityId && nameKey(other.title) === nameKey(entity.title)),references:[],plainCandidates:[],documents:[],entities:structuredClone(data.entities) }
  for (const node of data.nodes.filter(node => node.kind !== 'volume')) {
    if (typeof documents[node.id] !== 'string') throw new Error('无法读取全部正文，请重试后再生成改名预览：'+node.title)
    const before=documents[node.id]
    plan.documents.push({id:node.id,title:node.title,before})
    const found=scan(before,entity.title,{refKind:'node',refId:node.id,title:node.title,fieldPath:[]})
    plan.references.push(...found.references);plan.plainCandidates.push(...found.plainCandidates)
  }
  for (const record of data.entities) {
    for (const field of stringFields({content:record.content,tags:record.tags})) {
      const found=scan(field.text,entity.title,{refKind:'entity',refId:record.id,title:record.title,fieldPath:field.path})
      plan.references.push(...found.references);plan.plainCandidates.push(...found.plainCandidates)
    }
  }
  return plan
}

function replaceSelected(source: string, references: RenameReference[], title: string) {
  let result=source
  for (const reference of [...references].sort((a,b)=>b.from-a.from)) result=result.slice(0,reference.from)+'[['+title+']]'+result.slice(reference.to)
  return result
}
function updateStringField(record: EntityState,path: FieldPath[],references: RenameReference[],title:string) {
  for (const fieldPath of path) {
    let parent: unknown=record
    for (const key of fieldPath.slice(0,-1)) parent=(parent as Record<string|number,unknown>)[key]
    const key=fieldPath.at(-1)!
    const object=parent as Record<string|number,unknown>
    const found=references.filter(reference=>JSON.stringify(reference.fieldPath)===JSON.stringify(fieldPath))
    Object.defineProperty(object,key,{value:replaceSelected(String(object[key]),found,title),writable:true,configurable:true,enumerable:true})
  }
}
export function selectedWikiRenameChanges(plan: WikiRenamePlan, selectedIds: string[]): RenameChanges {
  const ids=new Set(selectedIds)
  if (ids.size !== selectedIds.length || selectedIds.some(id=>!plan.references.some(reference=>reference.id===id))) throw new Error('改名选项已失效，请重新预览')
  if (plan.ambiguous && ids.size) throw new Error('原名称对应多条资料，无法自动确定引用归属；请取消引用更新并先消除歧义')
  const selected=plan.references.filter(reference=>ids.has(reference.id))
  const documents=plan.documents.flatMap(document=>{
    const references=selected.filter(reference=>reference.refKind==='node' && reference.refId===document.id)
    return references.length ? [{id:document.id,before:document.before,after:replaceSelected(document.before,references,plan.newTitle)}] : []
  })
  const entities=plan.entities.flatMap(entity=>{
    const references=selected.filter(reference=>reference.refKind==='entity' && reference.refId===entity.id)
    if (!references.length && entity.id !== plan.entity.id) return []
    const before=entityState(entity),after=structuredClone(before)
    const paths=[...new Map(references.map(reference=>[JSON.stringify(reference.fieldPath),reference.fieldPath])).values()]
    updateStringField(after,paths,references,plan.newTitle)
    if (entity.id===plan.entity.id) {
      after.title=plan.newTitle
      if (plan.keepOldAlias) {
        const raw=after.content.alias ?? after.content.aliases
        const aliases=Array.isArray(raw)?raw.filter((item):item is string=>typeof item==='string'):typeof raw==='string'?raw.split(/[,，、;；/\n]/u):[]
        if (!aliases.some(alias=>nameKey(alias)===nameKey(before.title))) aliases.push(before.title)
        after.content.alias=Array.isArray(raw)?aliases:aliases.map(alias=>alias.trim()).filter(Boolean).join('，')
      }
    }
    return [{id:entity.id,before,after}]
  })
  return {documents,entities}
}

export interface WikiRenameOperation { id: string; label: string; createdAt: string; undoneBy: string | null }
