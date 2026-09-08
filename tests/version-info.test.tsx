import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ checkUpdates: vi.fn(), openExternalUrl: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/lib/api', () => ({ projectApi: api, isDesktop: true }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.1.0-rc.11' }))
import { VersionInfo } from '../src/components/VersionInfo'
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('checks only on demand and offers retry after a connection failure', async () => {
  api.checkUpdates.mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce({ currentVersion: '1.1.0-rc.11', latestVersion: '1.1.0', available: true, url: 'https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0' })
  render(<VersionInfo />)
  await waitFor(() => expect(screen.getByText('NovelForge 1.1.0-rc.11')).toBeTruthy())
  expect(api.checkUpdates).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络断开'))
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('发现新版本：1.1.0'))
  fireEvent.click(screen.getByRole('button', { name: '发布说明与安装包' }))
  expect(api.openExternalUrl).toHaveBeenCalledWith('https://github.com/Gunanzhao/NovelForge/releases/tag/v1.1.0')
})
