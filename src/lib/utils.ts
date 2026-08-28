export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)))
}

export function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export function formatFileDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

export function countWords(content: string) {
  return [...content].filter((character) => !/\s/u.test(character)).length
}

export function getObjectString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}
