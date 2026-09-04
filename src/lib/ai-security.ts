export function aiHttpConfirmationKey(endpoint: string): string | null {
  try {
    const url = new URL(endpoint.trim())
    if (url.protocol !== 'http:') return null
    const hostname = url.hostname.toLocaleLowerCase()
    const loopback = hostname === 'localhost'
      || hostname === '[::1]'
      || /^127(?:\.\d{1,3}){0,3}$/u.test(hostname)
    if (loopback) return null
    url.hash = ''
    return url.toString().replace(/\/$/u, '')
  } catch {
    return null
  }
}

export function confirmInsecureAiEndpoint(
  endpoint: string,
  confirmedEndpoints: Set<string>,
  confirm: (message: string) => boolean,
) {
  const key = aiHttpConfirmationKey(endpoint)
  if (!key || confirmedEndpoints.has(key)) return true
  const accepted = confirm('这个 AI Provider 使用非加密 HTTP。选中的小说内容和 API Key 可能被网络中的其他人读取或篡改。仍要发送吗？')
  if (accepted) confirmedEndpoints.add(key)
  return accepted
}
