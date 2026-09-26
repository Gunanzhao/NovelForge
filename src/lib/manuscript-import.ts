export const MAX_IMPORT_BYTES = 32 * 1024 * 1024
export type ImportEncoding = 'auto' | 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030'
export interface ImportBoundary { offset: number; title: string; line: number }
export interface ImportedChapter { title: string; content: string }
export interface ImportManuscriptInput { projectPath: string; parentId: string; requestId: string; chapters: ImportedChapter[] }

/** Decode once into a preview. No replacement characters or guessed legacy encoding. */
export function decodeManuscript(bytes: Uint8Array, encoding: ImportEncoding = 'auto'): { text: string; encoding: Exclude<ImportEncoding, 'auto'> } {
  if (!bytes.length) throw new Error('稿件文件为空。')
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('单次导入文件不能超过32 MiB。')
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8'
    : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : undefined
  if (bom && encoding !== 'auto' && encoding !== bom) throw new Error('所选编码与文件BOM不一致，请选择自动识别或正确编码。')
  const selected = encoding === 'auto' ? bom ?? 'utf-8' : encoding
  let text: string
  try { text = new TextDecoder(selected, { fatal: true }).decode(bytes) }
  catch { throw new Error('无法按所选编码完整解码，请检查文件或手动选择GB18030等原始编码。') }
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) throw new Error('文件包含二进制控制字符，不是可导入的纯文本稿件。')
  }
  if (!text.trim()) throw new Error('稿件没有正文内容。')
  return { text, encoding: selected }
}

/** Offset boundaries retain original newlines and all text, including preambles. */
export function detectImportBoundaries(text: string): ImportBoundary[] {
  const result: ImportBoundary[] = []
  let offset = 0, line = 0, frontmatter = false
  let fence: { char: string; count: number } | null = null
  for (const raw of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    line++
    const value = raw.replace(/\r?\n$/u, '')
    const trimmed = value.trim()
    if (line === 1 && trimmed === '---') { frontmatter = true; offset += raw.length; continue }
    if (frontmatter) {
      if (trimmed === '---' || trimmed === '...') frontmatter = false
      offset += raw.length; continue
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(value)
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.count && !marker[2].trim()) fence = null
      offset += raw.length; continue
    }
    if (marker) { fence = { char: marker[1][0], count: marker[1].length }; offset += raw.length; continue }
    // Indented code, quotes and lists are not chapter headings.
    if (!/^(?: {4}|\t|\s*>|\s*[-*+]\s)/u.test(value)) {
      const markdown = /^ {0,3}#{1,3}\s+(.+?)(?:\s+#+)?\s*$/u.exec(value)
      const plain = /^(?:第[零〇一二三四五六七八九十百千万两0-9０-９]+[章节卷回部篇](?:[\s：:、.．—-].*|[^\s]*)|chapter\s+[0-9ivxlcdm]+(?:[\s:：.-].*)?|序章|序言|楔子|引子|尾声|后记|终章)$/iu.test(trimmed)
      const title = markdown?.[1].trim() ?? (plain ? trimmed : '')
      if (title && title.length <= 200) result.push({ offset, title, line })
    }
    offset += raw.length
  }
  return result
}

export function splitManuscript(text: string, boundaries: readonly ImportBoundary[], fallbackTitle: string): ImportedChapter[] {
  const selected = [...boundaries].sort((a, b) => a.offset - b.offset)
  for (let i = 0; i < selected.length; i++) {
    const boundary = selected[i]
    if (!Number.isInteger(boundary.offset) || boundary.offset < 0 || boundary.offset >= text.length
      || (boundary.offset > 0 && text[boundary.offset - 1] !== '\n')
      || (i > 0 && boundary.offset === selected[i - 1].offset)) throw new Error('分章位置无效，请重新预览。')
    if (!boundary.title.trim()) throw new Error('章节名称不能为空。')
  }
  const result: ImportedChapter[] = []
  if (!selected.length) return [{ title: fallbackTitle.trim() || '导入稿件', content: text }]
  if (selected[0].offset > 0) result.push({ title: (fallbackTitle.trim() || '导入稿件') + ' · 开篇', content: text.slice(0, selected[0].offset) })
  selected.forEach((boundary, index) => result.push({ title: boundary.title.trim(), content: text.slice(boundary.offset, selected[index + 1]?.offset ?? text.length) }))
  return result
}

export function validateImportChapters(chapters: readonly ImportedChapter[], existingTitles: readonly string[]): void {
  if (!chapters.length || chapters.length > 2000) throw new Error('每次请导入1至2000个章节。')
  const titles = new Set(existingTitles.map(title => title.trim()))
  let size = 0
  for (const chapter of chapters) {
    const title = chapter.title.trim()
    if (!title || title.length > 200) throw new Error('章节名称须为1至200个字符。')
    if (titles.has(title)) throw new Error('存在同名章节：' + title + '。请先修改预览中的名称。')
    titles.add(title)
    size += new TextEncoder().encode(chapter.content).length
  }
  if (size > MAX_IMPORT_BYTES) throw new Error('导入正文总量不能超过32 MiB。')
}
