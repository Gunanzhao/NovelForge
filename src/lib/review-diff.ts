import { diffLines, type DiffLine } from './text-diff'

// Bound alignment work for long manuscripts; retain every line even when a
// large rewritten block has no nearby common anchor.
export function reviewDiff(original: string, candidate: string): DiffLine[] {
  const left = original.replace(/\r\n?/gu, '\n').split('\n'), right = candidate.replace(/\r\n?/gu, '\n').split('\n')
  if (left.length <= 800 && right.length <= 800) return diffLines(left.join('\n'), right.join('\n'))
  const result: DiffLine[] = []
  let a = 0, b = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { result.push({ kind: 'same', text: left[a++] }); b++; continue }
    const positions = new Map<string, number>()
    for (let j = b; j < Math.min(b + 128, right.length); j++) if (!positions.has(right[j])) positions.set(right[j], j)
    let nextA = Math.min(a + 128, left.length), nextB = Math.min(b + 128, right.length), distance = Infinity
    for (let i = a; i < Math.min(a + 128, left.length); i++) {
      const j = positions.get(left[i])
      if (j !== undefined && i - a + j - b < distance) { nextA = i; nextB = j; distance = i - a + j - b }
    }
    while (a < nextA) result.push({ kind: 'removed', text: left[a++] })
    while (b < nextB) result.push({ kind: 'added', text: right[b++] })
  }
  while (a < left.length) result.push({ kind: 'removed', text: left[a++] })
  while (b < right.length) result.push({ kind: 'added', text: right[b++] })
  return result
}
export function reviewBlocks(lines: DiffLine[]) {
  const blocks: { changed: boolean; lines: DiffLine[] }[] = []
  for (const line of lines) {
    const changed = line.kind !== 'same', previous = blocks[blocks.length - 1]
    if (previous?.changed === changed) previous.lines.push(line)
    else blocks.push({ changed, lines: [line] })
  }
  return blocks
}
