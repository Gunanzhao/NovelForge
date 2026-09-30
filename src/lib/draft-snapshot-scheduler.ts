export interface DraftSnapshot {
  id: string; projectId: string; projectPath: string; targetId: string; label: string
  version: number; capturedAt: string; payload: unknown; fingerprint?: string
}
export interface DraftTransport { put: (snapshot: DraftSnapshot) => Promise<void>; acknowledge: (id: string) => Promise<void> }
/** A fixed clock, independent of typing debounce and of React's component tree. */
export class DraftSnapshotScheduler {
  private entries = new Map<string, DraftSnapshot>()
  private persisted = new Map<string, string>()
  private busy = false
  private version = Date.now() * 1000
  constructor(private transport: DraftTransport, private error: (message: string) => void, private recovered: () => void = () => {}) {}
  update(key: string, input: Omit<DraftSnapshot, 'id' | 'version' | 'capturedAt'>, dirty: boolean) {
    const current = this.entries.get(key)
    if (!dirty) {
      // Only acknowledge an identical payload; an older save cannot clear new edits.
      if (current && JSON.stringify(current.payload) === JSON.stringify(input.payload)) {
        this.entries.delete(key)
        void this.transport.acknowledge(current.id).catch(() => this.error('独立草稿确认失败，恢复稿仍保留。'))
      }
      return
    }
    if (current && JSON.stringify(current.payload) === JSON.stringify(input.payload)) return
    this.entries.set(key, { ...input, payload: structuredClone(input.payload), id: crypto.randomUUID(), version: this.version = Math.max(this.version + 1, Date.now() * 1000), capturedAt: new Date().toISOString() })
  }
  async flush() {
    if (this.busy) return
    this.busy = true
    let failed = false, wrote = false
    try {
      for (const [key, snapshot] of this.entries) {
        if (this.persisted.get(key) === snapshot.id) continue
        try {
          await this.transport.put(snapshot)
          wrote = true
          this.persisted.set(key, snapshot.id)
          if (!this.entries.has(key)) await this.transport.acknowledge(snapshot.id)
        } catch { failed = true; this.error('独立草稿快照写入失败；请复制或另存当前内容，并检查恢复列表与磁盘空间。') }
      }
      if (wrote && !failed) this.recovered()
    } finally { this.busy = false }
  }
  rescue() { return [...this.entries.values()] }
}
