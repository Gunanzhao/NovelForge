import { expect, it } from 'vitest'
import { blankMemoryFields, memoryContextText, memoryStatus, parseChapterMemory, parseMemoryDraft } from '../src/lib/chapter-memory'
import { contextItems } from '../src/lib/ai-data'
import type { EntityRecord, NodeRecord } from '../src/lib/types'
const source='林月拿到钥匙。她不知道门后的真相。'
function entity(status='confirmed'):EntityRecord{return {id:'m',kind:'chapter-memory',title:'记忆',tags:[],filePath:'memory.md',createdAt:'',updatedAt:'',content:{...blankMemoryFields(),chapterId:'c',sourceText:source,summary:'林月取得钥匙',status,sources:[{id:'s',field:'summary',from:0,to:7,quote:'林月拿到钥匙。'}]}}}
const node:NodeRecord={id:'c',kind:'chapter',parentId:'v',title:'第一章',filePath:'c.md',status:'draft',orderIndex:0,createdAt:'',updatedAt:''}
it('parses structured memory while rejecting invented or ambiguous quotations',()=>{
 const draft=parseMemoryDraft('c',source,JSON.stringify({summary:'摘要',events:['取得钥匙'],sources:[{field:'events',quote:'林月拿到钥匙。'},{field:'knowledge',quote:'不存在的句子'},{field:'toString',quote:'林月拿到钥匙。'}]}))
 expect(draft.fields.events).toBe('取得钥匙');expect(draft.sources).toHaveLength(1)
 expect(parseMemoryDraft('c','重复。重复。',JSON.stringify({summary:'摘要',sources:[{field:'summary',quote:'重复。'}]})).sources).toHaveLength(0)
})
it('keeps non-structured model output as an unconfirmed editable summary draft',()=>{
 expect(parseMemoryDraft('c',source,'普通摘要草稿').fields.summary).toBe('普通摘要草稿');expect(parseMemoryDraft('c',source,'普通摘要草稿').sources).toEqual([])
})
it('includes provenance only when confirmed and exact source remains current',()=>{
 const memory=parseChapterMemory(entity())!;expect(memoryStatus(memory,source)).toBe('confirmed');expect(memoryStatus(memory,source+'新内容')).toBe('stale')
 expect(memoryContextText(memory,source,'第一章')).toContain('来源章节：第一章');expect(memoryContextText(memory,source,'第一章')).toContain('林月拿到钥匙。')
 expect(()=>memoryContextText(memory,source+'新内容','第一章')).toThrow('过期');expect(()=>memoryContextText(parseChapterMemory(entity('draft'))!,source,'第一章')).toThrow('未确认')
})
it('never offers drafts or current stale memory as selectable AI facts',()=>{
 expect(contextItems([node],[entity('draft')],'c',source).some(item=>item.kind==='memory')).toBe(false)
 expect(contextItems([node],[entity()],'c',source).find(item=>item.kind==='memory')?.detail).toContain('来源：第一章')
 expect(contextItems([node],[entity()],'c','修改后').some(item=>item.kind==='memory')).toBe(false)
})
