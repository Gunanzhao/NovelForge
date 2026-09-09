import { expect, it } from 'vitest'
import { buildNameTrie, scanAutoNames } from '../src/lib/auto-names'
import type { EntityRecord } from '../src/lib/types'
const entity = (id:string,title:string,kind:EntityRecord['kind']='character',content:Record<string,unknown>={}):EntityRecord => ({id,title,kind,content,tags:[],filePath:'',createdAt:'',updatedAt:''})
const names=[entity('a','林清舟','character',{alias:'清舟，林队长'}),entity('b','长安城','location'),entity('c','长安','world'),entity('d','Ann'),entity('e','Ann Lee'),entity('f','清舟','location')]
it('matches only known names, longest first, with aliases and ambiguous candidates',()=>{
  const matches=scanAutoNames('林清舟和清舟去了长安城。陌生人没有资料。',buildNameTrie(names))
  expect(matches.map(m=>m.text)).toEqual(['林清舟','清舟','长安城'])
  expect(matches[1].ids).toEqual(['a','f'])
})
it('preserves UTF-16 offsets, English boundaries, spaces and case',()=>{
  const text='😀Anna Ann Lee ann 林队长'
  const matches=scanAutoNames(text,buildNameTrie(names))
  expect(matches.map(m=>m.text)).toEqual(['Ann Lee','ann','林队长'])
  for(const match of matches)expect(text.slice(match.from,match.to)).toBe(match.text)
})
it('excludes metadata, existing links, code fences, inline code and URLs',()=>{
  const text='---\ntitle: 林清舟\n---\n[[林清舟]] `清舟` https://x.test/Ann\n```\n长安城\n```\n林清舟'
  expect(scanAutoNames(text,buildNameTrie(names)).map(m=>m.text)).toEqual(['林清舟'])
})
it('ignores a project term or specific entity and skips one-character aliases',()=>{
  const terms=[...names,entity('i','清舟','mention-ignore',{text:'清舟'}),entity('j','长安城','mention-ignore',{entityId:'b'}),entity('k','王','character',{alias:'她'})]
  expect(scanAutoNames('清舟 王 她 长安城 林清舟',buildNameTrie(terms)).map(m=>m.text)).toEqual(['长安','林清舟'])
})
it('limits marks to requested visible ranges without losing code-block context',()=>{
  const text='林清舟\n```\n清舟\n```\n长安城'
  expect(scanAutoNames(text,buildNameTrie(names),[{from:8,to:text.length}]).map(m=>m.text)).toEqual(['长安城'])
})
it('handles a large dictionary and manuscript without mutating text',()=>{
  const entities=Array.from({length:10000},(_,i)=>entity(String(i),'人物'+i+'号'))
  const text=('普通正文。'.repeat(100)+'人物9999号。\n').repeat(1000)
  const start=performance.now()
  const matches=scanAutoNames(text,buildNameTrie(entities),[{from:0,to:2000}])
  expect(matches.length).toBeGreaterThan(0)
  expect(performance.now()-start).toBeLessThan(5000)
  expect(text.startsWith('普通正文。')).toBe(true)
})
