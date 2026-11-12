import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { projectApi } from '../src/lib/api'
import { matchRevisionFile, revisionFileIssue } from '../src/lib/revision-batch'
import { RevisionBatchImport } from '../src/components/RevisionBatchImport'
import type { RevisionChapterSummary, RevisionRoundView } from '../src/lib/revision-workbench'
import { captureProjectSession, useAppStore } from '../src/stores/app-store'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const chapter = (nodeId: string, title: string): RevisionChapterSummary => ({ nodeId, title, kind: 'chapter', hasCandidate: false, confirmedAt: null, available: true, confirmationState: null })
it('only matches unique names and reports duplicate targets and existing drafts', () => {
  const chapters = [chapter('a', '第一章'), chapter('b', '第二章'), chapter('c', '第二章')]
  expect(matchRevisionFile('第一章.md', chapters)).toBe('a')
  expect(matchRevisionFile('第二章.txt', chapters)).toBe('')
  const file = { name: '第一章.txt', targetId: 'a', error: '', content: '改稿' }
  expect(revisionFileIssue(file, [file, { ...file, name: '第一章.md' }], chapters)).toContain('多个文件')
  expect(revisionFileIssue(file, [file], [{ ...chapters[0], hasCandidate: true }])).toContain('已有改稿')
})
function file(name: string, text: string) {
  const value = new File([text], name)
  Object.defineProperty(value, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  return value
}
it('previews before saving, refuses changed targets and never applies manuscript text', async () => {
  useAppStore.setState({ ...useAppStore.getInitialState(), projectPath: 'batch-test', projectSession: 10 })
  const chapters = [chapter('a', '第一章'), chapter('b', '第二章')]
  const open = vi.spyOn(projectApi, 'openRevisionRound').mockImplementation(async input => ({ current: { nodeId: input.nodeId, candidate: input.nodeId === 'b' ? '另一处已保存的改稿' : null, original: '原文', version: 4, confirmedAt: null, sourceIssue: null, currentContent: null } } as RevisionRoundView))
  const save = vi.spyOn(projectApi, 'saveRevisionCandidate').mockResolvedValue({} as never)
  const confirm = vi.spyOn(projectApi, 'confirmRevisionChapter')
  render(<RevisionBatchImport projectPath="batch-test" roundId="round" chapters={chapters} busy={false} error="" run={async action => { await action(captureProjectSession()); return true }} onRefresh={async () => {}} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('选择批量改稿文件'), { target: { files: [file('第一章.md', '改稿甲'), file('第二章.md', '改稿乙'), file('未匹配.md', '未知')] } })
  await screen.findByText('未匹配或名称重复，请选择目标')
  expect(open).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存匹配改稿（2）' }))
  await waitFor(() => expect(screen.getByText(/本次已保存 1 份/)).toBeTruthy())
  expect(save).toHaveBeenCalledExactlyOnceWith({ projectPath: 'batch-test', roundId: 'round', nodeId: 'a', expectedVersion: 4 }, '改稿甲')
  expect(screen.getByText(/目标已有改稿或已确认，未覆盖/)).toBeTruthy()
  expect(confirm).not.toHaveBeenCalled()
})
