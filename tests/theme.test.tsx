import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { useAppStore } from '../src/stores/app-store'

it('tracks system theme changes, unsubscribes for explicit themes and cleans up on unmount', () => {
  const listeners = new Set<() => void>()
  const media = { matches: false, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
  vi.stubGlobal('matchMedia', () => media)
  useAppStore.setState({ ...useAppStore.getInitialState(), theme: 'system' })
  const { unmount } = render(<App />)
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => { media.matches = true; listeners.forEach(listener => listener()) })
  expect(document.documentElement.dataset.theme).toBe('dark')
  act(() => useAppStore.getState().setTheme('light'))
  expect(listeners.size).toBe(0)
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => useAppStore.getState().setTheme('system'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  unmount()
  expect(listeners.size).toBe(0)
  vi.unstubAllGlobals()
})
