import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/components/Sidebar'
import { ContextMenuProvider } from '../src/components/ContextMenu'
import { Welcome } from '../src/components/shell/Welcome'
import { TopBar } from '../src/components/shell/TopBar'
import { filterTreeByTitle, flattenTree } from '../src/components/sidebar/tree'
import { projectApi } from '../src/lib/api'
import type { NodeRecord } from '../src/lib/types'
import { useAppStore } from '../src/stores/app-store'

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(useAppStore.getInitialState())
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function node(
  id: string,
  title: string,
  kind: NodeRecord['kind'],
  parentId: string | null,
  orderIndex = 0,
): NodeRecord {
  return {
    id,
    title,
    kind,
    parentId,
    orderIndex,
    status: 'draft',
    filePath: id,
    createdAt: '',
    updatedAt: '',
  }
}
const manuscript = [
  node('v', '第一卷', 'volume', null),
  node('a', '灯塔 Lighthouse', 'chapter', 'v', 1),
  node('b', '渡口', 'chapter', 'v', 0),
  node('s', '失踪的信', 'section', 'a'),
  node('z', '第二卷', 'volume', null, 1),
]

it('searches titles without losing ancestry, keeps matched chapter contents, and respects tree order', () => {
  const result = filterTreeByTitle(manuscript, '  LIGHTHOUSE  ')
  expect(result.map((item) => item.id)).toEqual(['v', 'a', 's'])
  expect(filterTreeByTitle(manuscript, '失踪').map((item) => item.id)).toEqual([
    'v',
    'a',
    's',
  ])
  expect(
    filterTreeByTitle(manuscript, '第一卷').map((item) => item.id),
  ).toEqual(['v', 'a', 'b', 's'])
  expect(filterTreeByTitle(manuscript, '不存在')).toEqual([])
  expect(filterTreeByTitle(manuscript, '  ')).toBe(manuscript)
  expect(
    flattenTree(manuscript, [manuscript[0]], new Set(['v', 'a'])).map((row) => [
      row.node.id,
      row.level,
    ]),
  ).toEqual([
    ['v', 0],
    ['b', 1],
    ['a', 1],
    ['s', 2],
  ])
})

it('finds a chapter inside a collapsed volume, opens it, and clears search with Escape', async () => {
  const path = 'studio-tree-' + crypto.randomUUID()
  const data = await projectApi.create({
    path,
    title: '目录查询',
    author: '',
    description: '',
    genre: '',
    targetWords: 1000,
  })
  const chapter = data.nodes.find((item) => item.kind === 'chapter')!
  useAppStore.setState({ projectPath: path, data })
  render(
    <ContextMenuProvider fallbackItems={[]}>
      <Sidebar
        onAddNode={() => {}}
        onMoveNode={() => {}}
        onCopyNode={() => {}}
        onExportNode={() => {}}
      />
    </ContextMenuProvider>,
  )
  expect(screen.queryByRole('button', { name: '第一章' })).toBeNull()
  fireEvent.change(screen.getByLabelText('查找章节'), {
    target: { value: '第一章' },
  })
  fireEvent.click(await screen.findByRole('button', { name: '第一章' }))
  await waitFor(() =>
    expect(useAppStore.getState().document?.node.id).toBe(chapter.id),
  )
  fireEvent.change(screen.getByLabelText('查找章节'), {
    target: { value: '不存在' },
  })
  expect(
    screen.getByText('没有匹配的章节，试试其他名称或筛选条件。'),
  ).toBeTruthy()
  fireEvent.keyDown(screen.getByLabelText('查找章节'), { key: 'Escape' })
  expect((screen.getByLabelText('查找章节') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('button', { name: '第一章' })).toBeTruthy()
})

it('filters recent projects by title or path and opens the selected original path', async () => {
  const openProject = vi.fn().mockResolvedValue(undefined)
  useAppStore.setState({
    openProject,
    recentProjects: [
      { path: 'D:/stories/lighthouse', title: '雾港来信', updatedAt: '' },
      { path: 'D:/stories/forest', title: '森林之书', updatedAt: '' },
    ],
  })
  render(<Welcome onProject={() => {}} />)
  fireEvent.change(screen.getByLabelText('查找最近项目'), {
    target: { value: 'LIGHTHOUSE' },
  })
  expect(screen.queryByText('森林之书')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /雾港来信/ }))
  expect(openProject).toHaveBeenCalledWith('D:/stories/lighthouse')
  fireEvent.change(screen.getByLabelText('查找最近项目'), {
    target: { value: '不存在' },
  })
  expect(screen.getByText('没有找到这部作品')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '查看全部作品' }))
  expect(screen.getByText('森林之书')).toBeTruthy()
})

it('opens quick navigation from the toolbar and exposes a focus mode action', () => {
  const quickOpen = vi.fn(),
    toggleFocusMode = vi.fn()
  window.addEventListener('novelforge:quick-open', quickOpen)
  useAppStore.setState({ toggleFocusMode, theme: 'light' })
  render(
    <TopBar
      onProject={() => {}}
      onExport={() => {}}
      onCloseProject={() => {}}
      inspectorVisible={false}
      onInspectorToggle={() => {}}
    />,
  )
  try {
    fireEvent.click(screen.getByRole('button', { name: '快速打开章节或资料' }))
    expect(quickOpen).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '进入专注模式' }))
    expect(toggleFocusMode).toHaveBeenCalledOnce()
  } finally {
    window.removeEventListener('novelforge:quick-open', quickOpen)
  }
})
