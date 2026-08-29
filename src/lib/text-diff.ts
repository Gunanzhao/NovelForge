export type DiffLineKind = 'same' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

export function diffLines(current: string, previous: string, maxLines = 800): DiffLine[] {
  const left = current.split(/\r?\n/u)
  const right = previous.split(/\r?\n/u)
  if (left.length > maxLines || right.length > maxLines) {
    return [
      ...right.map((text) => ({ kind: 'removed' as const, text })),
      ...left.map((text) => ({ kind: 'added' as const, text })),
    ]
  }
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      table[row][column] = left[row] === right[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1])
    }
  }
  const result: DiffLine[] = []
  let row = 0
  let column = 0
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      result.push({ kind: 'same', text: left[row] })
      row += 1
      column += 1
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      result.push({ kind: 'removed', text: left[row] })
      row += 1
    } else {
      result.push({ kind: 'added', text: right[column] })
      column += 1
    }
  }
  while (row < left.length) { result.push({ kind: 'removed', text: left[row] }); row += 1 }
  while (column < right.length) { result.push({ kind: 'added', text: right[column] }); column += 1 }
  return result
}
