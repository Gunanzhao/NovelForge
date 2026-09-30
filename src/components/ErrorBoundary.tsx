import { Component, type ReactNode } from 'react'
import { useAppStore } from '../stores/app-store'
import { writeClipboardText } from '../lib/clipboard'

/** Store lives outside the failed React subtree. Never reload or clear it. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean; rescue: string; status: string }> {
  state = { failed: false, rescue: '', status: '' }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() {
    this.setState({ rescue: useAppStore.getState().document?.content ?? '' })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <section className="panel" role="alert" style={{ padding: 24 }}>
      <h2>{this.props.label ?? '工作区'}显示失败</h2>
      <p>当前正文仍保留在内存中。请先复制或下载救援稿，再尝试重新显示。</p>
      <textarea aria-label="救援正文" readOnly value={this.state.rescue} style={{ width: '100%', minHeight: 180 }} />
      <button onClick={() => { void writeClipboardText(this.state.rescue).then(() => this.setState({ status: '正文已复制' })).catch(() => this.setState({ status: '复制失败，请在上方文本框中全选复制。' })) }}>复制正文</button>
      <button onClick={() => {
        let url: string | undefined
        try {
          url = URL.createObjectURL(new Blob([this.state.rescue], { type: 'text/markdown;charset=utf-8' }))
          const link = document.createElement('a'); link.href = url; link.download = 'NovelForge-rescue.md'; link.click()
          this.setState({ status: '已请求下载救援稿，请确认文件已保存。' })
        } catch { this.setState({ status: '下载失败，请在上方文本框中全选复制。' }) }
        finally { if (url) { const objectUrl = url; setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000) } }
      }}>下载救援稿</button>
      <button onClick={() => this.setState({ failed: false, status: '' })}>重新显示</button>
      {this.state.status ? <p role="status">{this.state.status}</p> : null}
    </section>
  }
}
