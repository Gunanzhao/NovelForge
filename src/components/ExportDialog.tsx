import { useState } from 'react'
import { FileArchive, FileDown, FileText } from 'lucide-react'
import type { ExportFormat } from '../lib/types'
import { Button, Modal } from './ui'

const formats: Array<{ id: ExportFormat; label: string; description: string; icon: typeof FileDown }> = [
  { id: 'markdown', label: 'Markdown', description: '保留标题层级和 Markdown 语法，适合继续编辑。', icon: FileText },
  { id: 'txt', label: '纯文本 TXT', description: '去掉 Markdown 标记，只保留纯文本内容。', icon: FileText },
  { id: 'docx', label: 'Word DOCX', description: '生成可在 Word/WPS 中打开的文档。', icon: FileDown },
  { id: 'epub', label: '电子书 EPUB', description: '生成带目录的 EPUB 电子书包。', icon: FileArchive },
  { id: 'pdf', label: 'PDF', description: '生成适合归档和打印的 PDF 文件。', icon: FileDown },
]

export function ExportDialog({ open, onClose, onExport }: { open: boolean; onClose: () => void; onExport: (format: ExportFormat) => Promise<void> }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  async function exportFormat(format: ExportFormat) {
    setBusy(format)
    try { await onExport(format); onClose() } finally { setBusy(null) }
  }
  return <Modal open={open} title="导出项目" onClose={() => { if (!busy) onClose() }} footer={<Button variant="outline" disabled={Boolean(busy)} onClick={onClose}>取消</Button>}><div className="export-dialog-copy">选择一种格式导出当前项目。导出文件会写入项目 `.novelforge/exports/`，不会修改正文。</div><div className="export-options">{formats.map(({ id, label, description, icon: Icon }) => <button type="button" key={id} className="export-option" disabled={Boolean(busy)} onClick={() => void exportFormat(id)}><span className="export-option-icon"><Icon size={16} /></span><span><strong>{busy === id ? '导出中…' : label}</strong><small>{description}</small></span></button>)}</div></Modal>
}

