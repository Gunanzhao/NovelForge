import { expect, it } from 'vitest'
import { normalizeLineBreaks, normalizedRangeFromSource, sourceRangeFromNormalizedText } from '../src/lib/newline-offsets'
it.each(['标题\r\n🌙林月拿到钥匙。\r\n后文', '标题\r🌙林月拿到钥匙。\n后文', '标题\n🌙林月拿到钥匙。\n后文'])('round trips editor and original UTF-16 ranges for %j', source => {
 const normalized = normalizeLineBreaks(source)
 const from = normalized.indexOf('🌙'), to = normalized.indexOf('后文')
 const range = sourceRangeFromNormalizedText(source, from, to)
 expect(normalizeLineBreaks(source.slice(range.from, range.to))).toBe(normalized.slice(from, to))
 expect(normalizedRangeFromSource(source, range.from, range.to)).toEqual({ from, to })
 expect(sourceRangeFromNormalizedText(source, normalized.length, normalized.length)).toEqual({ from: source.length, to: source.length })
})
