import { ChangeSet, type ChangeDesc } from '@codemirror/state'
import { aiEdits } from './ai-edit'
import type { AnnotationTracking, EntityRecord } from './types'
export const ANNOTATION_CATEGORIES = {revision:'文字修订',continuity:'设定与连续性',research:'待查资料',other:'其他'} as const
export type AnnotationCategory = keyof typeof ANNOTATION_CATEGORIES
export interface TextAnchor { sourceText:string; from:number; to:number }
export interface LocatedAnchor {from:number;to:number;orphaned:boolean}
export interface ManuscriptAnnotation extends TextAnchor {id:string;chapterId:string;revision:string;body:string;category:AnnotationCategory;status:'open'|'resolved';entity:EntityRecord}
export function parseAnnotation(entity:EntityRecord):ManuscriptAnnotation|null {
  const c=entity.content
  if(entity.kind!=='annotation'||typeof c.chapterId!=='string'||typeof c.anchorRevision!=='string'||typeof c.sourceText!=='string'||typeof c.body!=='string'||!Number.isInteger(c.from)||!Number.isInteger(c.to))return null
  const from=c.from as number,to=c.to as number
  if(from<0||to<=from||to>c.sourceText.length)return null
  return {id:entity.id,chapterId:c.chapterId,revision:c.anchorRevision,sourceText:c.sourceText,from,to,body:c.body,category:typeof c.category==='string'&&Object.hasOwn(ANNOTATION_CATEGORIES,c.category)?c.category as AnnotationCategory:'other',status:c.status==='resolved'?'resolved':'open',entity}
}
export function mapTextAnchor(anchor:LocatedAnchor,changes:ChangeDesc):LocatedAnchor {
  let deleted=0
  changes.iterChangedRanges((from,to)=>{deleted+=Math.max(0,Math.min(to,anchor.to)-Math.max(from,anchor.from))})
  const from=changes.mapPos(anchor.from,1),to=changes.mapPos(anchor.to,-1)
  return {from,to:Math.max(from,to),orphaned:anchor.orphaned||to<=from||deleted>=anchor.to-anchor.from}
}
// Bounded difference calculation reuses the same Unicode-aware algorithm as AI
// review. Full source text is retained in the local annotation for reopening,
// backup recovery and undo; a deleted target is never silently reattached.
export function locateTextAnchor(anchor:TextAnchor,text:string):LocatedAnchor {
  if(anchor.sourceText===text)return {from:anchor.from,to:anchor.to,orphaned:false}
  const edits=aiEdits(anchor.sourceText,text)
  const changes=ChangeSet.of(edits.map(edit=>({from:edit.from,to:edit.to,insert:edit.after})),anchor.sourceText.length, '\n')
  return mapTextAnchor({...anchor,orphaned:false},changes)
}
const cache=new Map<string,{revision:string;base:string;from:number;to:number;text:string;location:LocatedAnchor}>()
export function clearAnnotationLocations(){cache.clear()}
export function annotationLocation(annotation:ManuscriptAnnotation,text:string,tracking?:AnnotationTracking|null):LocatedAnchor {
  const cached=cache.get(annotation.id)
  if(cached&&cached.revision===annotation.revision&&cached.base===annotation.sourceText&&cached.from===annotation.from&&cached.to===annotation.to&&cached.text===text)return cached.location
  const tracked=tracking?.anchors.find(anchor=>anchor.id===annotation.id&&anchor.revision===annotation.revision)
  const location=annotation.sourceText===text?{from:annotation.from,to:annotation.to,orphaned:false}:tracked&&tracking
    ? tracking.content===text?tracked:mapTextAnchor(tracked,ChangeSet.of(aiEdits(tracking.content,text).map(edit=>({from:edit.from,to:edit.to,insert:edit.after})),tracking.content.length, '\n'))
    :locateTextAnchor(annotation,text)
  cache.set(annotation.id,{revision:annotation.revision,base:annotation.sourceText,from:annotation.from,to:annotation.to,text,location})
  if(cache.size>500)cache.delete(cache.keys().next().value!)
  return location
}
export function observeAnnotationEdits(annotations:ManuscriptAnnotation[],before:string,after:string,changes:ChangeDesc,tracking?:AnnotationTracking|null){
  for(const annotation of annotations){
    const location=annotation.sourceText===after?{from:annotation.from,to:annotation.to,orphaned:false}:mapTextAnchor(annotationLocation(annotation,before,tracking),changes)
    cache.set(annotation.id,{revision:annotation.revision,base:annotation.sourceText,from:annotation.from,to:annotation.to,text:after,location})
  }
}
export function chapterAnnotations(entities:EntityRecord[],chapterId?:string){return entities.map(parseAnnotation).filter((item):item is ManuscriptAnnotation=>Boolean(item&&(!chapterId||item.chapterId===chapterId)))}

export function savedAnnotationAnchors(entities:EntityRecord[],chapterId:string,text:string,tracking?:AnnotationTracking|null){
  return chapterAnnotations(entities,chapterId).map(annotation=>({id:annotation.id,revision:annotation.revision,...annotationLocation(annotation,text,tracking)}))
}
