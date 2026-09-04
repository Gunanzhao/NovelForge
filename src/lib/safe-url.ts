import { WIKI_LINK_HREF_PREFIX } from './markdown'

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const IMAGE_PROTOCOLS = new Set(['http:', 'https:'])
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/]+={0,2}$/iu
const URL_PROTOCOL = /^([a-z][a-z\d+.-]*):/iu

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function isSafeDataImage(value: string) {
  if (!SAFE_DATA_IMAGE.test(value)) return false
  const payload = value.slice(value.indexOf(',') + 1)
  return payload.length % 4 === 0
}

export type MarkdownUrlKind = 'link' | 'image'

export function safeMarkdownUrl(value: string | undefined, kind: MarkdownUrlKind): string | undefined {
  if (value === undefined) return undefined
  const url = value.trim()
  if (!url || hasControlCharacter(url) || url.startsWith('//') || url.startsWith('\\')) return undefined
  if (url.startsWith('#')) return url
  if (kind === 'link' && url.startsWith(WIKI_LINK_HREF_PREFIX)) return url
  if (kind === 'image' && isSafeDataImage(url)) return url

  const scheme = url.match(URL_PROTOCOL)?.[1]
  if (scheme) {
    const protocol = scheme.toLocaleLowerCase() + ':'
    const allowed = kind === 'image' ? IMAGE_PROTOCOLS : LINK_PROTOCOLS
    return allowed.has(protocol) ? url : undefined
  }
  return url
}

export function markdownUrlTransform(url: string, key: string) {
  return safeMarkdownUrl(url, key === 'src' ? 'image' : 'link')
}

export function isExternalMarkdownUrl(url: string | undefined) {
  return Boolean(url && /^https?:/iu.test(url))
}
