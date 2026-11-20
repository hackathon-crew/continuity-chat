import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { startAgent } from './agent/queue.ts'
import { config, validateConfig, type Config } from './config.ts'
import { PostgresStore } from './db/store.ts'
import { HttpError, sendError } from './http.ts'
import { routeApi } from './routes.ts'
import { UniGateClient } from './services/unigate.ts'
import type { Services } from './types.ts'

const contentTypes: Record<string, string> = {
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

async function staticPage(req: IncomingMessage, res: ServerResponse, url: URL, settings: Config) {
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
  const core = { settings, store, unigate: new UniGateClient(settings) }
  const services: Services = { ...core, agent: await startAgent(core) }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url as string, settings.publicUrl)
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
        await routeApi(req, res, url, services)
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
