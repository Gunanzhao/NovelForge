import { useEffect } from 'react'
import { clearAnnotationLocations } from '../../lib/annotations'
import { projectApi } from '../../lib/api'
import { useAutomaticBackups } from '../../lib/automatic-backups'
import { useAppStore } from '../../stores/app-store'

export function useWorkspaceLifecycle() {
  useAutomaticBackups()
  const data = useAppStore((state) => state.data)
  const document = useAppStore((state) => state.document)
  const projectPath = useAppStore((state) => state.projectPath)
  const saveState = useAppStore((state) => state.saveState)
  const loadRecent = useAppStore((state) => state.loadRecent)
  const theme = useAppStore((state) => state.theme)
  const saveCurrentDocument = useAppStore((state) => state.saveCurrentDocument)
  const refreshStats = useAppStore((state) => state.refreshStats)
  const projectSession = useAppStore((state) => state.projectSession)
  useEffect(() => {
    clearAnnotationLocations()
  }, [projectPath, projectSession])
  useEffect(() => {
    loadRecent()
  }, [loadRecent])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolved =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      globalThis.document.documentElement.dataset.theme = resolved
    }
    applyTheme()
    if (theme !== 'system') return
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    if (!projectPath) return
    const timer = window.setInterval(() => {
      const current = useAppStore.getState()
      if (
        !current.document ||
        current.projectPath !== projectPath ||
        current.saveState !== 'saved'
      )
        return
      void projectApi
        .createHistorySnapshot({
          projectPath,
          nodeId: current.document.node.id,
          content: current.document.content,
          kind: 'automatic',
        })
        .then(() => {
          if (useAppStore.getState().projectSession === current.projectSession)
            window.dispatchEvent(new Event('novelforge:history-changed'))
        })
        .catch((error) => {
          if (useAppStore.getState().projectSession === current.projectSession)
            useAppStore.getState().setError(error)
        })
    }, 300_000)
    return () => window.clearInterval(timer)
  }, [projectPath])

  useEffect(() => {
    if (saveState !== 'idle' || !document || !projectPath) return
    const timer = window.setTimeout(
      () => void saveCurrentDocument('自动保存'),
      900,
    )
    return () => window.clearTimeout(timer)
  }, [document, projectPath, saveState, saveCurrentDocument])

  useEffect(() => {
    if (data) void refreshStats()
  }, [data, refreshStats])

  useEffect(() => {
    const openConsistency = () => useAppStore.getState().setView('consistency')
    window.addEventListener('novelforge:open-consistency', openConsistency)
    return () =>
      window.removeEventListener('novelforge:open-consistency', openConsistency)
  }, [])
}
