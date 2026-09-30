import { expect, it } from 'vitest'
import fixture from './fixtures/reliability-contract.json'
import { fallbackInvoke } from '../src/lib/fallback'
import type { DocumentData, ProjectData } from '../src/lib/types'

it('shares Unicode lifecycle fixtures with the Rust/desktop contract (demo is not desktop evidence)', async () => {
  const path = 'contract-' + crypto.randomUUID()
  const created = await fallbackInvoke<ProjectData>('create_project', { input: { ...fixture.project, path } })
  const data = await fallbackInvoke<ProjectData>('create_node', { input: { ...fixture.node, projectPath: path, parentId: created.nodes.find(node => node.kind === 'volume')!.id } })
  const node = data.nodes.find(item => item.title === fixture.node.title)!
  const saved = await fallbackInvoke<DocumentData>('save_document', { input: { projectPath: path, nodeId: node.id, content: fixture.body, reason: '手动保存' } })
  expect(saved.content).toBe(fixture.body)
  const reopened = await fallbackInvoke<DocumentData>('get_document', { input: { projectPath: path, nodeId: node.id } })
  expect(reopened.content).toBe(fixture.body)
})
