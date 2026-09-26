import { create } from 'zustand'
import type { EntityRecord } from './types'
export const MEMORY_FIELDS={summary:'章节摘要',events:'关键事件',knowledge:'人物已知信息',changes:'关系、身份与物品变化',planted:'本章埋设伏笔',resolved:'本章回收伏笔',next:'下一章承接事项'} as const
export type MemoryField=keyof typeof MEMORY_FIELDS
export type MemoryFields=Record<MemoryField,string>
export interface MemorySource {id:string;field:MemoryField;from:number;to:number;quote:string}
export interface MemoryDraft {chapterId:string;sourceText:string;fields:MemoryFields;sources:MemorySource[]}
export interface ChapterMemory extends MemoryDraft {entity:EntityRecord;confirmed:boolean}
export const blankMemoryFields=():MemoryFields=>({summary:'',events:'',knowledge:'',changes:'',planted:'',resolved:'',next:''})
export const useMemoryImport=create<{draft:(MemoryDraft&{projectPath:string;session:number})|null}>(()=>({draft:null}))
export function parseChapterMemory(entity:EntityRecord):ChapterMemory|null {
  const content=entity.content
  if(entity.kind!=='chapter-memory'||typeof content.chapterId!=='string'||typeof content.sourceText!=='string')return null
  const sourceText=content.sourceText
  const fields=blankMemoryFields()
  for(const field of Object.keys(fields) as MemoryField[])fields[field]=typeof content[field]==='string'?content[field]:''
  const sources=Array.isArray(content.sources)?content.sources.filter((source):source is MemorySource=>Boolean(source&&typeof source==='object'&&typeof source.id==='string'&&Object.hasOwn(MEMORY_FIELDS,source.field)&&Number.isInteger(source.from)&&Number.isInteger(source.to)&&source.from>=0&&source.to>source.from&&source.to<=sourceText.length&&typeof source.quote==='string'&&sourceText.slice(source.from,source.to)===source.quote)):[]
  return {entity,chapterId:content.chapterId,sourceText:content.sourceText,fields,sources,confirmed:content.status==='confirmed'&&sources.length>0}
}
export function parseMemoryDraft(chapterId:string,sourceText:string,result:string):MemoryDraft {
  const fields=blankMemoryFields(),sources:MemorySource[]=[]
  try {
    const json=JSON.parse(result.trim().replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''))
    if(!json||typeof json!=='object'||Array.isArray(json))throw new Error('不是摘要对象')
    for(const field of Object.keys(fields) as MemoryField[])fields[field]=typeof json[field]==='string'?json[field]:Array.isArray(json[field])?json[field].filter((value:unknown)=>typeof value==='string').join('\n'):''
    if(!Object.values(fields).some(value=>value.trim()))throw new Error('摘要为空')
    for(const source of Array.isArray(json.sources)?json.sources:[]){
      if(!source||typeof source.field!=='string'||!(Object.hasOwn(MEMORY_FIELDS,source.field))||typeof source.quote!=='string'||!source.quote.trim())continue
      const from=sourceText.indexOf(source.quote)
      if(from<0||sourceText.indexOf(source.quote,from+1)>=0)continue
      sources.push({id:crypto.randomUUID(),field:source.field as MemoryField,from,to:from+source.quote.length,quote:source.quote})
    }
  }catch{fields.summary=result.trim()}
  return {chapterId,sourceText,fields,sources}
}
export function memoryStatus(memory:ChapterMemory,content:string|undefined):'draft'|'confirmed'|'stale'|'unavailable'{
  if(content===undefined)return 'unavailable'
  if(memory.sourceText!==content)return 'stale'
  return memory.confirmed?'confirmed':'draft'
}
export function memoryContextText(memory:ChapterMemory,content:string,chapterTitle:string):string {
  if(memoryStatus(memory,content)!=='confirmed')throw new Error('章节记忆未确认或已过期，请先复核原文')
  const facts=Object.entries(MEMORY_FIELDS).map(([field,label])=>memory.fields[field as MemoryField].trim()?`${label}：\n${memory.fields[field as MemoryField]}`:'').filter(Boolean).join('\n\n')
  const sources=memory.sources.map(source=>`${MEMORY_FIELDS[source.field]}依据（${chapterTitle}）：${source.quote}`).join('\n')
  return `来源章节：${chapterTitle}\n作者已确认；正文与确认时一致。\n${facts}\n\n原文依据：\n${sources}\n\n连续性提示供审阅；如有疑点，列出依据并交由作者判断，不自动改写正文。`
}
export const MEMORY_SUMMARY_INSTRUCTION='请仅依据所选章节生成JSON对象，字符串字段：summary（章节摘要）、events（关键事件）、knowledge（人物各自已知信息）、changes（关系身份物品变化）、planted（本章埋设伏笔）、resolved（本章回收伏笔）、next（下一章承接事项）。另附sources数组，每项包含field（对应字段名）和quote（该章节中的连续原文引文）。不确定的信息明确写为待作者核对，不补造事实；没有依据的字段留空。输出只作待确认草稿。'
