import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { readBody } from '../http.ts'
import type { AuthenticatedRequest } from '../types.ts'

export async function proxyModel({ req, res, url, user, services }: AuthenticatedRequest) {
  const { unigate, store } = services
  const method = req.method
  const body = method === 'POST' ? await readBody(req) : undefined
  const controller = new AbortController()
  res.once('close', () => controller.abort())
  const upstream = await unigate.model(url.pathname.slice(3), store.secret(user, 'model_key'), {
    method,
    body,
    signal: controller.signal,
  })
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  })
  if (upstream.body) {
    await pipeline(Readable.fromWeb(upstream.body), res)
  } else {
    res.end()
  }
}
