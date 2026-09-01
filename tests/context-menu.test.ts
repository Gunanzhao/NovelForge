import { describe, expect, it } from 'vitest'
import {
  clampContextMenuPosition, firstEnabledContextMenuIndex, normalizeContextMenuItems,
  submenuContextMenuPosition,
} from '../src/lib/context-menu'

describe('context menu geometry and normalization', () => {
  it('removes leading, trailing and repeated separators', () => {
    const items = normalizeContextMenuItems([
      { type: 'separator' },
      { type: 'separator' },
      { type: 'item', id: 'one', label: '一', onSelect: () => undefined },
      { type: 'separator' },
      { type: 'separator' },
      { type: 'item', id: 'two', label: '二', disabled: true, onSelect: () => undefined },
      { type: 'separator' },
    ])
    expect(items.map((item) => item.type)).toEqual(['item', 'separator', 'item'])
    expect(firstEnabledContextMenuIndex(items)).toBe(0)
  })

  it('keeps the primary menu inside all four viewport edges', () => {
    expect(clampContextMenuPosition({ x: 2, y: 3 }, { width: 236, height: 180 }, { width: 800, height: 600 })).toEqual({ left: 8, top: 8 })
    expect(clampContextMenuPosition({ x: 790, y: 590 }, { width: 236, height: 180 }, { width: 800, height: 600 })).toEqual({ left: 554, top: 410 })
  })

  it('flips a submenu to the left when the right side is unavailable', () => {
    expect(submenuContextMenuPosition({ left: 700, right: 790, top: 500, bottom: 532 }, { width: 220, height: 160 }, { width: 800, height: 600 })).toEqual({ left: 476, top: 340 })
    expect(submenuContextMenuPosition({ left: 30, right: 120, top: 20, bottom: 52 }, { width: 220, height: 160 }, { width: 800, height: 600 })).toEqual({ left: 124, top: 20 })
  })
})
