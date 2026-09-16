import { Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { annotationLocation, observeAnnotationEdits, type ManuscriptAnnotation } from './annotations'
import type { AnnotationTracking } from './types'
export function annotationExtension(annotations:ManuscriptAnnotation[],tracking?:AnnotationTracking|null){
  function decorations(text:string):DecorationSet {
    return Decoration.set(annotations.filter(item=>item.status==='open').flatMap(item=>{const range=annotationLocation(item,text,tracking);return range.orphaned||range.to<=range.from?[]:[Decoration.mark({class:'cm-manuscript-annotation',attributes:{title:item.body}}).range(range.from,range.to)]}),true)
  }
  return ViewPlugin.define(view=>({
    decorations:decorations(view.state.doc.toString()),
    update(update:ViewUpdate){if(update.docChanged){observeAnnotationEdits(annotations,update.startState.doc.toString(),update.state.doc.toString(),update.changes,tracking);this.decorations=decorations(update.state.doc.toString())}},
  }),{decorations:value=>value.decorations})
}
