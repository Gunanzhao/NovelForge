import { expect, it } from 'vitest'
import { relatedRecords } from '../src/lib/related-records'
import type { EntityRecord } from '../src/lib/types'
const person = { id: 'person-id', title: '林月', kind: 'character' } as EntityRecord
it('follows explicit names, ids and Wiki links without matching partial names', () => {
  const record = (id: string, content: unknown) => ({ id, title: id, kind: 'foreshadowing', content }) as EntityRecord
  const records = [record('a', { characters: '林月, 周景' }), record('b', { description: '与[[林月]]重逢' }), record('c', { ids: ['person-id'] }), record('d', { characters: '林月明' })]
  expect(relatedRecords(person, records).map(item => item.id)).toEqual(['a', 'b', 'c'])
})
