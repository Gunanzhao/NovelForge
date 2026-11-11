import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { searchEntity } from '../src/lib/entity-search'
import type { EntityRecord, ProjectData } from '../src/lib/types'
vi.mock('../src/components/ContextMenu', () => ({ useContextMenu: () => ({ openContextMenu: vi.fn() }) }))
vi.mock('../src/components/CharacterAppearance', () => ({ CharacterAppearancePanel: () => null }))
import { EntityView } from '../src/components/EntityView'
import { useAppStore } from '../src/stores/app-store'

const character: EntityRecord = { id: 'lin', kind: 'character', title: '林舟', tags: ['主角'], content: { alias: '渡鸦', identity: '守夜人', background: '旧港'.repeat(80) + '失落的航海图' + '港口'.repeat(80), customSecret: '银色钥匙', parentId: 'internal-parent' }, filePath: '', createdAt: '', updatedAt: '' }
const project: ProjectData = { project: { formatVersion: 1, id: 'p', title: 'P', author: '', description: '', genre: '', targetWords: 0, createdAt: '', updatedAt: '' }, nodes: [], entities: [character], recovery: [] }
beforeEach(() => useAppStore.setState({ ...useAppStore.getInitialState(), data: project, projectPath: 'search-test', selectedEntityId: null }))

it('finds names, aliases and tags without enabling body search', () => {
  expect(searchEntity(character, ' 林舟 ')?.field).toBe('名称')
  expect(searchEntity(character, '渡鸦')?.field).toBe('别名')
  expect(searchEntity(character, '主角')?.field).toBe('标签')
  expect(searchEntity({ ...character, content: { aliases: ['Raven', '旧名'] } }, 'rAvEn')?.excerpt).toBe('Raven、旧名')
  expect(searchEntity(character, '舟渡')).toBeNull()
  expect(searchEntity(character, '  ')).toBeNull()
})

it('searches settings and custom fields only when requested, without exposing internal fields', () => {
  expect(searchEntity(character, '守夜人')).toBeNull()
  expect(searchEntity(character, '守夜人', true)?.field).toBe('身份 / 职业')
  expect(searchEntity(character, '银色钥匙', true)?.field).toBe('customSecret')
  expect(searchEntity(character, 'internal-parent', true)).toBeNull()
})

it('centres a long matching passage and provides the exact highlight range', () => {
  const hit = searchEntity(character, '航海图', true)!
  expect(hit.excerpt.startsWith('…')).toBe(true)
  expect(hit.excerpt.endsWith('…')).toBe(true)
  expect(hit.excerpt.length).toBeLessThan(100)
  expect(hit.excerpt.slice(hit.from, hit.to)).toBe('航海图')
  expect(searchEntity({ ...character, content: { alias: '[鸦].*' } }, '[鸦].*')?.field).toBe('别名')
})

it('shows alias matches and lets the user expand the scope to settings with visible context', () => {
  render(<EntityView kind="character" />)
  const input = screen.getByRole('textbox', { name: '搜索人物' })
  fireEvent.change(input, { target: { value: '渡鸦' } })
  expect(screen.getByRole('button', { name: /林舟.*别名：\s*渡鸦/ })).toBeTruthy()
  expect(screen.getByText('渡鸦', { selector: 'mark' })).toBeTruthy()
  fireEvent.change(input, { target: { value: '守夜人' } })
  expect(screen.queryByRole('button', { name: /林舟/ })).toBeNull()
  expect(screen.getByText(/找到 0 条资料/)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: '搜索设定正文' }))
  expect(screen.getByRole('button', { name: /林舟.*身份 \/ 职业：\s*守夜人/ })).toBeTruthy()
  expect(screen.getByText(/找到 1 条资料/)).toBeTruthy()
  expect(useAppStore.getState().data?.entities).toEqual([character])
})
