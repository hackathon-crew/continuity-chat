import dns from 'node:dns'
import ipaddr from 'ipaddr.js'
import { Agent } from 'undici'

const requestTimeoutMs = 12_000
const maxPageBytes = 1024 * 1024
const maxPageText = 12_000

function isPublicIp(ip: string) {
  const addr = ipaddr.process(ip)
  return addr.range() === 'unicast'
}

const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, resolve) {
      const callback = resolve as (
        error: NodeJS.ErrnoException | null,
        address?: string | dns.LookupAddress[],
        family?: number
      ) => void
      dns.lookup(hostname, { all: true }, (error, addresses) => {
        if (error) {
          callback(error)
        } else if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
          callback(new Error('只允许访问公开网络地址'))
        } else if (options.all) {
          callback(null, addresses)
        } else {
          callback(null, addresses[0].address, addresses[0].family)
        }
      })
    },
  },
})

// Node's fetch types use a different undici version from the dispatcher.
const fetchDispatcher = dispatcher as unknown as RequestInit['dispatcher']

export function publicUrl(value: string | URL, requireTLS = false) {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (requireTLS && url.protocol !== 'https:') ||
    (ipaddr.isValid(host) && !isPublicIp(host)) ||
    (!host.includes('.') && !host.includes(':'))
  ) {
    throw new Error('请输入公开网页或 HTTPS 服务地址')
  }
  return url
}

export function publicFetch(input: Parameters<typeof fetch>[0], options: RequestInit = {}) {
  publicUrl(input instanceof Request ? input.url : input)
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
  return fetch(input, { ...options, dispatcher: fetchDispatcher, signal, redirect: 'error' })
}

export async function readWebPage(value: string, signal?: AbortSignal) {
  let url = publicUrl(value)
  for (let hops = 0; hops < 4; hops++) {
    const timeout = AbortSignal.timeout(requestTimeoutMs)
    const response = await fetch(url, {
      dispatcher: fetchDispatcher,
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      await response.body?.cancel()
      url = publicUrl(new URL(response.headers.get('location') as string, url))
      continue
    }
    const media = response.headers.get('content-type') ?? ''
    if (!response.ok || !/^(text\/(html|plain)|application\/xhtml\+xml)/i.test(media)) {
      await response.body?.cancel()
      throw new Error('这个地址没有返回可读取的网页')
    }
    const decoder = new TextDecoder()
    let size = 0
    let html = ''
    for await (const chunk of response.body as NonNullable<Response['body']>) {
      size += chunk.length
      if (size > maxPageBytes) {
        break
      }
      html += decoder.decode(chunk, { stream: true })
    }
    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]
    const text = html
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[^]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxPageText)
    return { url: url.href, title: title?.trim() || url.hostname, text }
  }
  throw new Error('网页重定向次数超出限制')
}
