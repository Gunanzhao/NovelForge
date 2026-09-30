import { afterEach, expect, it, vi } from 'vitest'
import { DraftSnapshotScheduler, type DraftSnapshot } from '../src/lib/draft-snapshot-scheduler'
const input = { projectId: 'p', projectPath: 'P', targetId: 'document:n', label: '正文', payload: { content: 'v1' } }
afterEach(() => vi.useRealTimers())
it('protects continuous typing at a fixed 10 second cadence without a 900ms gap', async () => {
  vi.useFakeTimers()
  const put = vi.fn(async () => {}), scheduler = new DraftSnapshotScheduler({ put, acknowledge: vi.fn(async () => {}) }, vi.fn())
  const timer = setInterval(() => { void scheduler.flush() }, 10_000)
  for (let i = 0; i < 62; i++) { scheduler.update('n', { ...input, payload: { content: String(i) } }, true); await vi.advanceTimersByTimeAsync(500) }
  expect(put).toHaveBeenCalledTimes(3)
  expect(put.mock.calls.map(call => (call as unknown as [DraftSnapshot])[0].payload)).toEqual([{ content: '19' }, { content: '39' }, { content: '59' }])
  clearInterval(timer)
})
it('an old save or write completion cannot acknowledge the newer version, including project switching', async () => {
  let resolve!: () => void
  const put = vi.fn().mockImplementationOnce(() => new Promise<void>(yes => { resolve = yes })).mockResolvedValue(undefined)
  const acknowledge = vi.fn(async () => {})
  const scheduler = new DraftSnapshotScheduler({ put, acknowledge }, vi.fn())
  scheduler.update('n', input, true); const flushing = scheduler.flush()
  const old = scheduler.rescue()[0].id
  scheduler.update('n', { ...input, payload: { content: 'v2' } }, true)
  scheduler.update('n', input, false) // completion of v1
  scheduler.update('q', { ...input, projectId: 'q', projectPath: 'Q' }, true)
  resolve(); await flushing; await scheduler.flush()
  expect(acknowledge).not.toHaveBeenCalledWith(old)
  expect(scheduler.rescue()).toHaveLength(2)
  expect(scheduler.rescue()[0].payload).toEqual({ content: 'v2' })
  const latest = scheduler.rescue()[0].id
  scheduler.update('n', { ...input, payload: { content: 'v2' } }, false)
  expect(acknowledge).toHaveBeenCalledWith(latest)
})
it('keeps serializable form payloads after render unmount and visibly retries failed snapshot writes', async () => {
  const put = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined), error = vi.fn()
  const scheduler = new DraftSnapshotScheduler({ put, acknowledge: vi.fn(async () => {}) }, error)
  const draft = { title: '人物', customFields: [{ key: '来历', value: '未保存' }] }
  scheduler.update('entity:1', { ...input, targetId: 'character:1', payload: draft }, true)
  draft.title = 'outside mutation'
  await scheduler.flush(); expect(error).toHaveBeenCalledOnce()
  await scheduler.flush(); expect(put).toHaveBeenCalledTimes(2)
  expect(scheduler.rescue()[0].payload).toEqual({ title: '人物', customFields: [{ key: '来历', value: '未保存' }] })
})
