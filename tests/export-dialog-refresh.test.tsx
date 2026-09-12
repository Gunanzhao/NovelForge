import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExportDialog } from '../src/components/ExportDialog'
import { useAppStore } from '../src/stores/app-store'
import type { ProjectData } from '../src/lib/types'

const data: ProjectData = { project: { id:'audit',formatVersion:1,title:'审查项目',author:'',description:'',genre:'',targetWords:1,createdAt:'',updatedAt:'' }, nodes:[
  {id:'v',kind:'volume',parentId:null,title:'第一卷',orderIndex:0,status:'draft',filePath:'manuscript/v',createdAt:'',updatedAt:''},
  {id:'a',kind:'chapter',parentId:'v',title:'第一章',orderIndex:0,status:'draft',filePath:'manuscript/v/a.md',createdAt:'',updatedAt:''},
],entities:[],recovery:[] }
afterEach(() => { cleanup(); useAppStore.setState(useAppStore.getInitialState(),true) })

it('preserves export options across autosave and resets on reopening', () => {
  const props = {open:true,onClose:vi.fn(),onExport:vi.fn(),currentNodeId:'a',data}
  const view = render(<ExportDialog {...props} />)
  fireEvent.click(screen.getByRole('button',{name:/DOCX.*Word/}))
  fireEvent.change(screen.getByLabelText('导出范围'),{target:{value:'chapters'}})
  expect(screen.getByRole('button',{name:'导出 Word DOCX'})).toBeTruthy()
  const saved = {...data,nodes:data.nodes.map(n=>n.id==='a'?{...n,updatedAt:'2026-09-12T12:00:00Z'}:n)}
  view.rerender(<ExportDialog {...props} data={saved} />)
  expect((screen.getByLabelText('导出范围') as HTMLSelectElement).value).toBe('chapters')
  expect(screen.getByRole('button',{name:'导出 Word DOCX'})).toBeTruthy()
  view.rerender(<ExportDialog {...props} open={false} />)
  view.rerender(<ExportDialog {...props} />)
  expect((screen.getByLabelText('导出范围') as HTMLSelectElement).value).toBe('project')
  expect(screen.getByRole('button',{name:'导出 Markdown'})).toBeTruthy()
})

