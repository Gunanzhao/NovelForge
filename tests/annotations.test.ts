import { ChangeSet, Text } from '@codemirror/state'
import { beforeEach, expect, it } from 'vitest'
import { annotationLocation, clearAnnotationLocations, locateTextAnchor, mapTextAnchor, observeAnnotationEdits, type ManuscriptAnnotation } from '../src/lib/annotations'
beforeEach(clearAnnotationLocations)
it('maps insertions before a selection but excludes boundary text',()=>{
 const anchor={sourceText:'前文选中内容后文',from:2,to:6}
 expect(locateTextAnchor(anchor,'新增前文选中内容后文')).toEqual({from:4,to:8,orphaned:false})
 expect(mapTextAnchor({...anchor,orphaned:false},ChangeSet.of([{from:2,insert:'左'},{from:6,insert:'右'}],anchor.sourceText.length))).toEqual({from:3,to:7,orphaned:false})
})
it('keeps the range through edits within a passage and marks full deletion orphaned',()=>{
 const anchor={sourceText:'前文需要修改的句子后文',from:2,to:9}
 expect(locateTextAnchor(anchor,'前文需要仔细修改的句子后文')).toEqual({from:2,to:11,orphaned:false})
 expect(locateTextAnchor(anchor,'前文后文').orphaned).toBe(true)
 expect(mapTextAnchor({...anchor,orphaned:false},ChangeSet.of({from:2,to:9,insert:'完全不同'},anchor.sourceText.length)).orphaned).toBe(true)
})
it('handles multiple edits and UTF16 emoji without splitting selected ranges',()=>{
 const anchor={sourceText:'🌙开头。目标段落。结尾。',from:5,to:9}
 const current='🌙新增开头。目标段落。新的结尾。'
 expect(current.slice(locateTextAnchor(anchor,current).from,locateTextAnchor(anchor,current).to)).toBe('目标段落')
})
it('uses exact editor changes for duplicate passages and restores anchors on undo',()=>{
 const source='重复段落。重复段落。'
 const annotation={id:'a',sourceText:source,from:0,to:4} as ManuscriptAnnotation
 const changes=ChangeSet.of({from:0,to:5},source.length)
 observeAnnotationEdits([annotation],source,'重复段落。',changes)
 expect(annotationLocation(annotation,'重复段落。').orphaned).toBe(true)
 observeAnnotationEdits([annotation],'重复段落。',source,changes.invert(Text.of(source.split('\n'))))
 expect(annotationLocation(annotation,source)).toEqual({from:0,to:4,orphaned:false})
})
it('bounds the difference calculation for long rewritten manuscripts',()=>{
 const source='甲'.repeat(100_000)+'原文目标'+'乙'.repeat(100_000)
 expect(locateTextAnchor({sourceText:source,from:100_000,to:100_004},'完全重写').orphaned).toBe(true)
})
it('reopening uses the transactionally saved orphan marker for duplicated passages',()=>{
 const annotation={id:'a',revision:'r',sourceText:'重复段落。重复段落。',from:0,to:4} as ManuscriptAnnotation
 clearAnnotationLocations()
 expect(annotationLocation(annotation,'重复段落。',{content:'重复段落。',anchors:[{id:'a',revision:'r',from:0,to:0,orphaned:true}]}).orphaned).toBe(true)
})

it('preserves CRLF offsets when new paragraphs precede an annotation',()=>{
 const source='开头。\r\n目标段落。结束。'
 const text='新增。\r\n另一段。\r\n'+source
 const from=source.indexOf('目标'),to=from+4
 expect(locateTextAnchor({sourceText:source,from,to},text)).toEqual({from:text.indexOf('目标'),to:text.indexOf('目标')+4,orphaned:false})
 const annotation={id:'crlf',revision:'r',sourceText:'旧正文。目标段落',from:4,to:8} as ManuscriptAnnotation
 expect(annotationLocation(annotation,text,{content:source,anchors:[{id:'crlf',revision:'r',from,to,orphaned:false}]})).toEqual({from:text.indexOf('目标'),to:text.indexOf('目标')+4,orphaned:false})
})
