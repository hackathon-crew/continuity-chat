import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from './config.ts'
import type { PostgresStore } from './store.ts'
import { hashToken } from './security.ts'

export class HttpError extends Error {
  declare readonly status: number
  declare readonly code: string

  constructor(status: number, message: string, code = 'request_error') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function sendJson(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

export function sendError(res: ServerResponse, error: unknown) {
  if (res.destroyed) {
    return
  }
  if (res.headersSent) {
    res.end()
    return
  }
  if (!(error instanceof HttpError)) {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`)
    return sendJson(res, 500, {
      error: { code: 'internal_error', message: '服务无法完成操作，已保留当前对话' },
    })
  }
  sendJson(res, error.status, { error: { code: error.code, message: error.message } })
}

const jsonBodyLimit = 1024 * 1024

export async function readBody(req: IncomingMessage, limit = jsonBodyLimit) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) {
      req.resume()
      throw new HttpError(413, '请求内容过大', 'body_too_large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readJson<T extends object = Record<string, unknown>>(
  req: IncomingMessage,
  limit?: number
): Promise<T> {
  const body = await readBody(req, limit)
  try {
    const value = JSON.parse(body.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected object')
    }
    return value as T
  } catch {
    throw new HttpError(400, '请求不是有效的 JSON 对象', 'invalid_json')
  }
}

export function cookieValue(req: IncomingMessage, name: string) {
  const cookie = (req.headers.cookie ?? '')
    .split(/;\s*/)
    .find((part) => part.startsWith(`${name}=`))
  return cookie?.slice(name.length + 1)
}

export function cookie(
  settings: Pick<Config, 'publicUrl'>,
  name: string,
  token: string,
  maxAge: number
) {
  const secure = new URL(settings.publicUrl).protocol === 'https:' ? '; Secure' : ''
  return `${name}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

export function redirect(res: ServerResponse, url: string, cookies: string[] = []) {
  res.writeHead(303, {
    Location: url,
    'Set-Cookie': cookies,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  res.end()
}

export function checkSameOrigin(req: IncomingMessage, settings: Pick<Config, 'publicUrl'>) {
  const origin = req.headers.origin
  if (origin && origin !== new URL(settings.publicUrl).origin) {
    throw new HttpError(403, '请求来源不受信任', 'origin_mismatch')
  }
}

export async function requireUser(req: IncomingMessage, store: Pick<PostgresStore, 'session'>) {
  const token = cookieValue(req, 'continuity_session')
  const user = token && (await store.session(hashToken(token)))
  if (!user) {
    throw new HttpError(401, '请先登录 UniGate', 'unauthorized')
  }
  return user
}
