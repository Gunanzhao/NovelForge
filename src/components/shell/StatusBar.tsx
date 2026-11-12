import { BookOpen } from 'lucide-react'
import { dirtyDrafts, useDraftGuard } from '../../lib/draft-guard'
import { countWords, formatNumber } from '../../lib/utils'
import { useAppStore } from '../../stores/app-store'
import { BackupStatusIndicator } from '../BackupWorkspaceStatus'
export function StatusBar({
  onBackupSettings,
}: {
  onBackupSettings: () => void
}) {
  useDraftGuard((state) => state.revision)
  const pendingDrafts = dirtyDrafts()
  const document = useAppStore((state) => state.document)
  const stats = useAppStore((state) => state.stats)
  const saveState = useAppStore((state) => state.saveState)
  const toggleFocusMode = useAppStore((state) => state.toggleFocusMode)
  return (
    <footer className="statusbar">
      <span>
        {document ? (
          <>
            <BookOpen size={12} />
            {document.node.title}
          </>
        ) : (
          '未选择章节'
        )}
      </span>
      <span title="按非空白字符计数，含标点；不计空格与换行">
        {document ? formatNumber(countWords(document.content)) + ' 字' : '0 字'}
      </span>
      <span>今日 +{formatNumber(stats.todayWords)}</span>
      <span className="status-spacer" />
      <BackupStatusIndicator onSettings={onBackupSettings} />
      <span className={'save-indicator ' + saveState}>
        {pendingDrafts.length
          ? pendingDrafts.map((draft) => draft.label).join('、') + ' · 未保存'
          : saveState === 'saving'
            ? '正文正在保存…'
            : saveState === 'error'
              ? '正文保存失败'
              : saveState === 'saved'
                ? '正文已保存'
                : document
                  ? '有未保存修改'
                  : '就绪'}
      </span>
      <button className="status-focus" onClick={toggleFocusMode}>
        F11 专注模式
      </button>
    </footer>
  )
}
