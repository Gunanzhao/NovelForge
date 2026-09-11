import { useMemo, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { openMarkdownLink } from '../lib/markdown-navigation'
import { wikiMarkdown, wikiTargetFromHref } from '../lib/markdown'
import { isExternalMarkdownUrl, markdownUrlTransform } from '../lib/safe-url'
import { useAppStore } from '../stores/app-store'
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

function PreviewImage({ src, alt, ...props }: ComponentProps<'img'>) {
  const session = useAppStore(state => state.projectSession)
  const [permission, setPermission] = useState<{ src: string; session: number } | null>(null)
  if (!src) return <span>{alt ?? ''}</span>
  if (isExternalMarkdownUrl(src) && (permission?.src !== src || permission.session !== session)) {
    return <span className="external-image-placeholder"><span>{alt || '外部图片'} · {src.split('/')[2] || '外部地址'}</span>{' '}<button type="button" className="button outline" onClick={() => setPermission({ src, session })}>加载外部图片</button><small>加载会向图片服务器发送请求。</small></span>
  }
  return <img {...props} src={src} alt={alt ?? ''} referrerPolicy="no-referrer" />
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
          onClick={(event) => {
            if (href.startsWith('#')) return
            event.preventDefault()
            void openMarkdownLink(href)
          }}
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
      return <PreviewImage {...imageProps} src={src} alt={alt} />
    },
  }), [entities, onWikiLink])

  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    remarkRehypeOptions={remarkRehypeOptions}
    components={components}
    urlTransform={markdownUrlTransform}
  >{preview}</ReactMarkdown>
}
