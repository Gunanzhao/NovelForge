import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Sidebar } from '../src/components/Sidebar'
import { ContextMenuProvider } from '../src/components/ContextMenu'
import { projectApi } from '../src/lib/api'
import { useAppStore } from '../src/stores/app-store'
afterEach(cleanup)
it('makes import, memory and revision views reachable through real navigation buttons', async () => {
  const path = 'navigation-' + crypto.randomUUID()
  const data = await projectApi.create({ path, title: '导航回归', author: '', description: '', genre: '', targetWords: 1 })
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: path, data })
  render(<ContextMenuProvider fallbackItems={[]}><Sidebar onAddNode={() => {}} onMoveNode={() => {}} onCopyNode={() => {}} onExportNode={() => {}} /></ContextMenuProvider>)
  for (const [label, view] of [['稿件导入', 'manuscript-import'], ['章节记忆', 'chapter-memory'], ['批注与修订', 'annotation']]) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(useAppStore.getState().activeView).toBe(view))
  }
})
