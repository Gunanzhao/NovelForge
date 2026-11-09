import { useLayoutEffect, useRef } from 'react'

export function useKeyboardListScroll(open: boolean, query: string, activeIndex: number) {
  const listRef = useRef<HTMLDivElement>(null)
  const keyboard = useRef(false)

  useLayoutEffect(() => {
    keyboard.current = false
    if (open && listRef.current) listRef.current.scrollTop = 0
  }, [open, query])

  useLayoutEffect(() => {
    const list = listRef.current
    const row = list?.children[activeIndex]
    if (!open || !keyboard.current || !list || !row) return
    const top = list.getBoundingClientRect().top + list.clientTop
    const bottom = top + list.clientHeight
    const bounds = row.getBoundingClientRect()
    if (bounds.top < top) list.scrollTop -= top - bounds.top
    else if (bounds.bottom > bottom) list.scrollTop += bounds.bottom - bottom
  }, [activeIndex, open])

  return { listRef, keyboard }
}
