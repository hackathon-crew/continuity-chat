import { createHash } from 'node:crypto'
import { config } from './config.js'
import { hashToken } from './security.js'

export class HttpError extends Error {
  constructor(status, message, code = 'request_error') {
    super(message)
    this.status = status
    this.code = code
  }
}

export const sendJson = (res, status, value) => {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

export const sendError = (res, error) => {
  const status = error instanceof HttpError ? error.status : 500
  if (status === 500) {
    process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`)
  }
  sendJson(res, status, {
    error: {
      code: error.code ?? 'internal_error',
      message: status === 500 ? '服务暂时不可用，请稍后重试' : error.message,
    },
  })
}

export async function readBody(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      throw new HttpError(413, '请求内容过大', 'body_too_large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readJson(req, limit) {
  const body = await readBody(req, limit)
  if (body.length === 0) {
    return {}
  }
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, '请求不是有效的 JSON', 'invalid_json')
  }
}

export const parseCookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie ?? '').split(';').flatMap((part) => {
      const index = part.indexOf('=')
      if (index < 0) {
        return []
      }
      return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]]
    })
  )

export async function authenticate(req, store) {
  const token = parseCookies(req).continuity_session
  if (!token) {
    return null
  }
  const tokenHash = hashToken(token)
  const session = store.read((data) => data.sessions.find((item) => item.tokenHash === tokenHash))
  if (!session || session.expiresAt < Date.now()) {
    return null
  }
  return store.read((data) => data.users.find((item) => item.id === session.userId)) ?? null
}

export async function requireUser(req, store) {
  const user = await authenticate(req, store)
  if (!user) {
    throw new HttpError(401, '请先登录', 'unauthorized')
  }
  return user
}

export const sessionCookie = (token, maxAge = 30 * 24 * 60 * 60) =>
  [
    `continuity_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
    config.cookieSecure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')

export const checkSameOrigin = (req) => {
  const origin = req.headers.origin
  if (!origin) {
    return
  }
  try {
    if (new URL(origin).host !== req.headers.host) {
      throw new HttpError(403, '请求来源不受信任', 'origin_mismatch')
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error
    }
    throw new HttpError(403, '请求来源无效', 'origin_mismatch')
  }
}

export const requestFingerprint = (req) =>
  createHash('sha256')
    .update(req.socket.remoteAddress ?? 'unknown')
    .digest('hex')
