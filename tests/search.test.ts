import { describe, expect, it } from 'vitest'
import { searchSegments } from '../src/lib/search-data'

describe('search result highlighting', () => {
  it('removes backend mark wrappers and highlights every query term safely', () => {
    expect(searchSegments('<mark>雾港</mark>的林月', '雾港')).toEqual([
      { text: '雾港', match: true }, { text: '的林月', match: false },
    ])
    expect(searchSegments('AldEn returns', 'alden', false)[0]).toEqual({ text: 'AldEn', match: true })
    expect(searchSegments('AldEn returns', 'alden', true)[0]).toEqual({ text: 'AldEn returns', match: false })
  })
})
