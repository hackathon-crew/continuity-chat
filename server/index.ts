import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { startAgent } from './agent/queue.ts'
import { routeAgent } from './agent/routes.ts'
import { downloadConversationFile, importConversation } from './archive.ts'
import { streamTurn } from './chat.ts'
import { billing, finishLogin, logout, publicUser, startLogin } from './auth.ts'
import { config, validateConfig } from './config.ts'
import {
  createConversation,
  deleteConversation,
  editConversation,
  findConversation,
  conversationSummary,
  getTurns,
  listConversations,
  uuidPattern,
} from './conversations.ts'
import {
  HttpError,
  checkSameOrigin,
  readBody,
  readJson,
  requireUser,
  sendError,
  sendJson,
} from './http.ts'
import { PostgresStore } from './store.ts'
import { UniGateClient } from './unigate.ts'

const openAIPaths = new Map([
  ['/v1/models', 'GET'],
  ['/v1/chat/completions', 'POST'],
])

async function proxyModel(req, res, url, user, { unigate, store }) {
  const method = openAIPaths.get(url.pathname)
  if (method !== req.method) {
    throw new HttpError(404, '模型接口不存在', 'not_found')
  }
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

async function api(req, res, url, services) {
  const { settings, store } = services
  const method = req.method
  const pathname = url.pathname
  if (!['GET', 'HEAD'].includes(method)) {
    checkSameOrigin(req, settings)
  }

  if (method === 'GET') {
    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true })
    }
    if (pathname === '/api/auth/login') {
      return startLogin(req, res, services)
    }
    if (pathname === '/api/auth/callback') {
      return finishLogin(req, res, url, services)
    }
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    return logout(req, res, services)
  }
  const user = await requireUser(req, store)
  if (pathname === '/api/agent' || pathname.startsWith('/api/agent/')) {
    return routeAgent(req, res, pathname, user, services)
  }
  if (pathname.startsWith('/v1/')) {
    return proxyModel(req, res, url, user, services)
  }
  if (method === 'GET' && pathname === '/api/auth/me') {
    return sendJson(res, 200, publicUser(user))
  }
  if (method === 'GET' && pathname === '/api/billing') {
    const page = Math.max(1, Math.min(1000, Math.trunc(Number(url.searchParams.get('page')) || 1)))
    return billing(res, user, services, page)
  }

  if (pathname === '/api/conversations') {
    if (method === 'GET') {
      return sendJson(res, 200, await listConversations(store.db, user.id))
    }
    if (method === 'POST') {
      return sendJson(res, 201, await createConversation(store.db, user.id, await readJson(req)))
    }
  }

  if (method === 'POST' && pathname === '/api/conversations/import') {
    return importConversation(req, res, store, user)
  }
  const streamId = /^\/api\/conversations\/([^/]+)\/turns$/.exec(pathname)?.[1]
  if (method === 'POST' && streamId && uuidPattern.test(streamId)) {
    return streamTurn(req, res, streamId, user, services)
  }
  const file = /^\/api\/conversations\/([^/]+)\/files\/([^/]+)$/.exec(pathname)
  if (method === 'GET' && file && uuidPattern.test(file[1])) {
    return downloadConversationFile(res, store.db, user.id, file[1], decodeURIComponent(file[2]))
  }

  const id = /^\/api\/conversations\/([^/]+)$/.exec(pathname)?.[1]
  if (id && uuidPattern.test(id)) {
    if (method === 'GET') {
      const row = await findConversation(store.db, user.id, id)
      return sendJson(res, 200, {
        ...conversationSummary(row),
        turns: await getTurns(store.db, id),
      })
    }
    if (method === 'PATCH') {
      return sendJson(res, 200, await editConversation(store.db, user.id, id, await readJson(req)))
    }
    if (method === 'DELETE') {
      await deleteConversation(store.db, user.id, id)
      return sendJson(res, 200, { ok: true })
    }
  }
  throw new HttpError(404, '请求的接口不存在', 'not_found')
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

async function staticPage(req, res, url, settings) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, '请求方式不支持')
  }
  const dist = path.join(settings.root, 'dist')
  let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`)
  if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) {
    throw new HttpError(404, '页面不存在')
  }
  if (url.pathname === '/' || !path.extname(file)) {
    file = path.join(dist, 'index.html')
  }
  const entry = await stat(file).catch(() => null)
  if (!entry?.isFile()) {
    throw new HttpError(404, '页面不存在，请先构建前端')
  }
  res.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': entry.size,
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') {
    return res.end()
  }
  await pipeline(createReadStream(file), res)
}

export async function createApplication(settings = config) {
  validateConfig(settings)
  const store = new PostgresStore(settings)
  await store.init()
  const services = { settings, store, unigate: new UniGateClient(settings) }
  services.agent = await startAgent(services)
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, settings.publicUrl)
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
        await api(req, res, url, services)
      } else {
        await staticPage(req, res, url, settings)
      }
    } catch (error) {
      sendError(res, error)
    }
  })
  server.on('close', () => {
    void services.agent.stop().then(() => store.db.end())
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createApplication()
  process.once('SIGTERM', () => server.close())
  process.once('SIGINT', () => server.close())
  server.listen(config.port, config.host, () =>
    process.stdout.write(`Unigate Chat listening on ${config.host}:${config.port}\n`)
  )
}
