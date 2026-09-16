import { expect, it } from 'vitest'
import { planWikiRename, selectedWikiRenameChanges } from '../src/lib/wiki-rename'
import type { ProjectData } from '../src/lib/types'
const data:ProjectData={project:{id:'p',formatVersion:1,title:'测试',author:'',description:'',genre:'',targetWords:1,createdAt:'',updatedAt:''},nodes:[{id:'c',kind:'chapter',title:'第一章',parentId:null,filePath:'c.md',orderIndex:0,status:'draft',createdAt:'',updatedAt:''}],entities:[{id:'person',kind:'character',title:'林月',content:{alias:'小月'},tags:[],filePath:'p.md',createdAt:'',updatedAt:''},{id:'plot',kind:'outline',title:'剧情',content:{summary:'[[林月]]离开',nested:[{note:'交给[[林月]]'}]},tags:[],filePath:'o.md',createdAt:'',updatedAt:''}],recovery:[]}
it('previews explicit references and treats plain text as non-editable candidates',()=>{
 const source='林月遇见[[林月]]，随后[[ 林月 ]]离开。'
 const plan=planWikiRename(data,{c:source},'person','林遥')
 expect(plan.references).toHaveLength(4);expect(plan.plainCandidates).toHaveLength(1)
 const changes=selectedWikiRenameChanges(plan,plan.references.map(reference=>reference.id))
 expect(changes.documents[0].after).toBe('林月遇见[[林遥]]，随后[[林遥]]离开。')
 expect(changes.entities.find(entity=>entity.id==='person')!.after.content.alias).toBe('小月，林月')
 expect(changes.entities.find(entity=>entity.id==='plot')!.after.content).toEqual({summary:'[[林遥]]离开',nested:[{note:'交给[[林遥]]'}]})
 expect(data.entities[0].title).toBe('林月')
})
it('preserves code metadata comments destinations and escaped links byte for byte',()=>{
 const excluded=['---\nname: "[[林月]]"\n---','```txt\n[[林月]]\n```','    [[林月]]','> ```txt\n> [[林月]]\n> ```','`[[林月]]`','<!-- [[林月]] -->','[链接](https://example.com/[[林月]])','\\[[林月]]'].join('\n\n')
 const source=excluded+'\n\n正文[[林月]]'
 const plan=planWikiRename(data,{c:source},'person','林遥')
 const nodeReferences=plan.references.filter(reference=>reference.refKind==='node')
 expect(nodeReferences).toHaveLength(1)
 expect(selectedWikiRenameChanges(plan,nodeReferences.map(reference=>reference.id)).documents[0].after).toBe(excluded+'\n\n正文[[林遥]]')
})
it('only changes selected positions, including UTF16 offsets after emoji',()=>{
 const plan=planWikiRename(data,{c:'🌙[[林月]]和[[林月]]'},'person','林遥',false)
 const refs=plan.references.filter(reference=>reference.refKind==='node')
 const changes=selectedWikiRenameChanges(plan,[refs[1].id])
 expect(changes.documents[0].after).toBe('🌙[[林月]]和[[林遥]]')
 expect(changes.entities).toHaveLength(1);expect(changes.entities[0].after.content.alias).toBe('小月')
})
it('blocks ambiguous reference updates and destination collisions',()=>{
 const duplicate={...data,entities:[...data.entities,{...data.entities[0],id:'other'}]}
 const plan=planWikiRename(duplicate,{c:'[[林月]]'},'person','林遥')
 expect(plan.ambiguous).toBe(true)
 expect(()=>selectedWikiRenameChanges(plan,plan.references.map(reference=>reference.id))).toThrow('歧义')
 expect(selectedWikiRenameChanges(plan,[]).documents).toHaveLength(0)
 expect(()=>planWikiRename(data,{c:''},'person','剧情')).toThrow('已被其他资料使用')
})
it('refuses partial manuscript reads and unknown selection IDs',()=>{
 expect(()=>planWikiRename(data,{},'person','林遥')).toThrow('无法读取全部正文')
 const plan=planWikiRename(data,{c:'[[林月]]'},'person','林遥')
 expect(()=>selectedWikiRenameChanges(plan,['not-a-reference'])).toThrow('失效')
 expect(()=>planWikiRename(data,{c:''},'person','坏[名称]')).toThrow('方括号')
})
