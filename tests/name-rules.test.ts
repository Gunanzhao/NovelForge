import { expect, it } from 'vitest'
import { generateNames, NAME_CATEGORIES, NAME_STYLES } from '../src/lib/name-generator'

it('every category and style can produce thirty unique natural names', () => {
  for (const { id } of NAME_CATEGORIES) for (const style of NAME_STYLES) {
    const names = generateNames(id, 30, style)
    expect(names.length, `${id}/${style}`).toBe(30)
    expect(new Set(names).size).toBe(30)
    expect(names.every(name => !/\d/u.test(name))).toBe(true)
  }
})
it('honors surname, length, required and excluded characters', () => {
  const names = generateNames('character', 10, '中文古风', { surname: '欧阳', length: 4, required: '清', excluded: '月' })
  expect(names).toHaveLength(10)
  expect(names.every(name => name.startsWith('欧阳') && name.length === 4 && name.includes('清') && !name.includes('月'))).toBe(true)
})
it('keeps family and group naming consistent, honors custom vocabulary', () => {
  const family = generateNames('character', 8, '中文古风', { surname: '林', series: 'family', shared: '知', length: 3 })
  expect(family).toHaveLength(8)
  expect(family.every(name => name.startsWith('林知'))).toBe(true)
  const ships = generateNames('ship', 6, '科幻', { series: 'shared', shared: '远航', roots: ['星', '海', '光'], suffix: '号', banned: ['海'] })
  expect(ships).toHaveLength(6)
  expect(ships.every(name => name.startsWith('远航') && name.endsWith('号') && !name.includes('海'))).toBe(true)
})
it('never breaks constraints to fill a batch and avoids history and existing names', () => {
  expect(generateNames('character', 30, '中文现代', { required: '安', excluded: '安' })).toEqual([])
  const first = generateNames('character', 30)
  const next = generateNames('character', 30, '中文现代', { previousNames: first, avoidNames: first })
  expect(next).toHaveLength(30)
  expect(next.some(name => first.includes(name))).toBe(false)
})
