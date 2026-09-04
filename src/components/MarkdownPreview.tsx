import { useMemo, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { wikiMarkdown, wikiTargetFromHref } from '../lib/markdown'
import { isExternalMarkdownUrl, markdownUrlTransform } from '../lib/safe-url'
import type { EntityRecord } from '../lib/types'

export interface MarkdownPreviewProps {
  markdown: string
  entities?: EntityRecord[]
  onWikiLink: (target: string) => void
}

function wikiTitleKey(title: string) {
  return title.trim().toLocaleLowerCase()
}

/**
 * The editor and exported HTML use the same GFM footnote semantics. The
 * labels are explicitly translated because remark-rehype otherwise emits
 * English ARIA labels even when the manuscript is Chinese.
 */
const remarkRehypeOptions = {
  footnoteLabel: '脚注',
  footnoteBackLabel: (referenceIndex: number, rereferenceIndex: number) => {
    const suffix = rereferenceIndex > 1 ? '-' + rereferenceIndex : ''
    return '返回正文 ' + (referenceIndex + 1) + suffix
  },
}

export function MarkdownPreview({ markdown, entities = [], onWikiLink }: MarkdownPreviewProps) {
  const preview = useMemo(() => wikiMarkdown(markdown), [markdown])
  const components = useMemo(() => ({
    a: ({ node, href, children, ...anchorProps }: ComponentProps<'a'> & { node?: unknown }) => {
      void node
      const target = wikiTargetFromHref(href)
      if (!target) {
        if (!href) return <span>{children}</span>
        return <a
          {...anchorProps}
          href={href}
          rel={isExternalMarkdownUrl(href) ? 'noopener noreferrer' : anchorProps.rel}
        >{children}</a>
      }
      const candidates = entities.filter((entity) => wikiTitleKey(entity.title) === wikiTitleKey(target))
      const duplicate = candidates.length > 1
      return <a
        {...anchorProps}
        href={href}
        className={'wiki-link' + (duplicate ? ' ambiguous' : candidates.length ? '' : ' missing')}
        aria-label={duplicate ? target + '（多个同名条目）' : candidates.length ? target : target + '（未建档）'}
        onClick={(event) => {
          event.preventDefault()
          onWikiLink(target)
        }}
      >{children}</a>
    },
    img: ({ node, src, alt, ...imageProps }: ComponentProps<'img'> & { node?: unknown }) => {
      void node
      if (!src) return <span>{alt ?? ''}</span>
      return <img {...imageProps} src={src} alt={alt ?? ''} referrerPolicy="no-referrer" />
    },
  }), [entities, onWikiLink])

  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    remarkRehypeOptions={remarkRehypeOptions}
    components={components}
    urlTransform={markdownUrlTransform}
  >{preview}</ReactMarkdown>
}
