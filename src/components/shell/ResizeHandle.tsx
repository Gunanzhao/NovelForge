import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
export function ResizeHandle({
  side,
  width,
  onResize,
}: {
  side: 'sidebar' | 'inspector'
  width: number
  onResize: (width: number) => void
}) {
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const origin = event.clientX
    const initial = width
    const update = (move: PointerEvent) => {
      const delta =
        side === 'sidebar' ? move.clientX - origin : origin - move.clientX
      onResize(initial + delta)
    }
    const finish = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish, { once: true })
  }
  function nudge(event: ReactKeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0
    if (!delta) return
    event.preventDefault()
    onResize(width + (side === 'sidebar' ? delta : -delta))
  }
  return (
    <div
      className={'panel-resize-handle ' + side}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'sidebar' ? '调整左栏宽度' : '调整辅助栏宽度'}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={nudge}
    />
  )
}
