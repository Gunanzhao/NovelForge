import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { EntityRecord } from './types'
import type { AutoNameMatch } from './auto-names'
export function autoNameExtension(entities: EntityRecord[], open: (match: AutoNameMatch, view: EditorView) => void, close: () => void) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none
    worker: Worker
    timer?: ReturnType<typeof setTimeout>
    generation = 0
    matches: AutoNameMatch[] = []
    sentDocument?: EditorView['state']['doc']
    down?: {x:number;y:number}
    constructor(readonly view: EditorView) {
      this.worker = new Worker(new URL('./auto-names.worker.ts', import.meta.url), {type:'module'})
      this.worker.postMessage({entities})
      this.worker.onmessage = (event: MessageEvent<{id:number;matches:AutoNameMatch[]}>) => {
        if (event.data.id !== this.generation || view.composing || !view.dom.isConnected) return
        this.matches = event.data.matches
        this.decorations = Decoration.set(this.matches.map(match => Decoration.mark({class:'cm-auto-name', attributes:{'data-auto-name':match.text, title:'点击查看资料'}}).range(match.from,match.to)),true)
        view.dispatch({})
      }
      this.schedule()
    }
    schedule() {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        if (this.view.composing) { this.schedule(); return }
        const doc = this.view.state.doc
        this.worker.postMessage({id:this.generation,source:this.sentDocument === doc ? undefined : doc.toString(),visible:this.view.visibleRanges})
        this.sentDocument = doc
      },300)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.generation++; this.matches = []
        this.decorations = this.decorations.map(update.changes)
        if (update.docChanged) close()
        this.schedule()
      }
    }
    destroy() { clearTimeout(this.timer); this.worker.terminate() }
  }, {
    decorations: plugin => plugin.decorations,
    eventHandlers: {
      mousedown(event) { this.down = event.button === 0 ? {x:event.clientX,y:event.clientY} : undefined },
      click(event) {
        const down = this.down; this.down = undefined
        if (!down || event.detail !== 1 || event.ctrlKey || event.metaKey || event.shiftKey || this.view.composing || !this.view.state.selection.main.empty || Math.hypot(event.clientX-down.x,event.clientY-down.y)>4) return false
        const pos = this.view.posAtCoords({x:event.clientX,y:event.clientY})
        const match = this.matches.find(item => pos !== null && pos >= item.from && pos < item.to)
        if (match) open(match,this.view)
        return false
      },
      compositionend() { this.generation++; this.schedule() },
      scroll() { close() },
    },
  })
}
