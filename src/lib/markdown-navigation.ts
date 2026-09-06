import { isDesktop, projectApi } from './api'
import { useAppStore } from '../stores/app-store'
export async function openMarkdownLink(href: string) {
  try {
    if (/^(https?:|mailto:)/iu.test(href)) {
      if (isDesktop) await projectApi.openExternalUrl(href)
      else window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    const state = useAppStore.getState()
    const target = new URL(href, 'https://novelforge.invalid/' + (state.document?.node.filePath ?? ''))
    const filePath = decodeURIComponent(target.pathname).replace(/^\//u, '')
    const node = state.data?.nodes.find(item => item.filePath.replace(/\\/gu, '/') === filePath && item.kind !== 'volume')
    if (!node || target.origin !== 'https://novelforge.invalid') throw new Error('未找到项目内链接对应的正文：' + href)
    await state.selectNode(node.id)
  } catch (error) { useAppStore.getState().setError(error) }
}
