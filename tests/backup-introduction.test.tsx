import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BackupStatusIndicator, BackupWorkspaceNotice } from '../src/components/BackupWorkspaceStatus'
import { useAutoBackup } from '../src/lib/automatic-backups'
import { projectApi } from '../src/lib/api'
import { useAppStore } from '../src/stores/app-store'

beforeEach(async () => {
  localStorage.clear()
  const path = 'backup-introduction-' + crypto.randomUUID(), data = await projectApi.create({ path, title: '备份引导', author: '', genre: '', description: '', targetWords: 1 })
  const document = await projectApi.getDocument({ projectPath: path, nodeId: data.nodes.find(node => node.kind === 'chapter')!.id })
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: path, data, document: { ...document, persistedContent: document.content }, saveState: 'saved' })
  useAutoBackup.setState({ path, busy: false, error: '', status: { settings: { enabled: false, directory: '', trigger: 'session', keep: 5, lastAttempt: null, lastSuccess: null, lastError: null, lastFingerprint: null, archives: [] }, cleanup: [], availableBytes: null, message: '' } })
})
afterEach(cleanup)
function save(text: string) {
  act(() => {
    const document = useAppStore.getState().document!
    useAppStore.setState({ document: { ...document, content: text, persistedContent: text }, saveState: 'saved' })
  })
}
it('shows unset and paused backup states with a direct settings entry', () => {
  const settings = vi.fn()
  render(<BackupStatusIndicator onSettings={settings} />)
  fireEvent.click(screen.getByRole('button', { name: '独立备份未设置' }))
  expect(settings).toHaveBeenCalledOnce()
  act(() => useAutoBackup.setState(state => ({ status: { ...state.status!, settings: { ...state.status!.settings, lastSuccess: '2026-11-11T12:00:00Z' } } })))
  expect(screen.getByRole('button', { name: '独立备份已暂停' })).toBeTruthy()
})
it('offers setup after meaningful saved writing and remembers a skip across remounts', () => {
  const view = render(<BackupWorkspaceNotice hidden={false} onSettings={() => {}} />)
  expect(screen.queryByRole('button', { name: '暂时跳过' })).toBeNull()
  save('林舟走过港口，抬头看见灯塔。他把旧地图收好，等待渡船归来。')
  fireEvent.click(screen.getByRole('button', { name: '暂时跳过' }))
  view.unmount()
  render(<BackupWorkspaceNotice hidden={false} onSettings={() => {}} />)
  save('林舟走过港口，抬头看见灯塔。他把旧地图收好，等待渡船归来。潮水落了。')
  expect(screen.queryByRole('button', { name: '暂时跳过' })).toBeNull()
})
it('keeps errors visible ahead of the optional introduction', () => {
  render(<BackupWorkspaceNotice hidden={false} onSettings={() => {}} />)
  save('林舟走过港口，抬头看见灯塔。他把旧地图收好，等待渡船归来。')
  act(() => useAutoBackup.setState({ error: '目录不可写' }))
  expect(screen.getByText('目录不可写')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '暂时跳过' })).toBeNull()
})
