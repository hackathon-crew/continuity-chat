import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import { userInfo } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import type { UsageRow } from '../contract/types.ts'
import { createDevelopmentDatabase, developmentDatabase } from '../server/db/development.ts'
import { readJson, redirect, sendError, sendJson } from '../server/http.ts'
import type { UniGateAccount } from '../server/types.ts'

const loopback = '127.0.0.1'
const publicPort = '3080'
const publicUrl = `http://localhost:${publicPort}`
const fakePort = 3082
const fakeUrl = `http://${loopback}:${fakePort}`
const oauthPath = '/api/v1/oauth/unigate-chat'
const streamIntervalMs = 350
const modelBodyLimit = 24 * 1024 * 1024

const account: UniGateAccount = {
  id: 1,
  username: '本机开发账户',
  email: 'developer@localhost',
  balance: 25,
  frozen_balance: 0,
}
const usage: UsageRow = {
  id: 1,
  model: 'deepseek-local',
  created_at: '2026-11-20T08:00:00Z',
  input_tokens: 20,
  output_tokens: 8,
  actual_cost: 0.01,
}
const models = [
  { id: 'deepseek-local', display_name: 'DeepSeek（本机）', owned_by: 'deepseek' },
  { id: 'gpt-local', display_name: 'GPT（本机）', owned_by: 'openai' },
]

async function streamReply(res: ServerResponse, model: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
  const reply = ['这是本机 UniGate 的流式回复。', '这条回复不会产生费用。']
  function chunk(delta: { role?: 'assistant'; content?: string }, finishReason: 'stop' | null) {
    res.write(
      `data: ${JSON.stringify({
        id: 'local-completion',
        object: 'chat.completion.chunk',
        created: 0,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`
    )
  }

  chunk({ role: 'assistant' }, null)
  for (const content of reply) {
    await delay(streamIntervalMs)
    if (res.destroyed) {
      return
    }
    chunk({ content }, null)
  }
  await delay(streamIntervalMs)
  if (!res.destroyed) {
    chunk({}, 'stop')
    res.end('data: [DONE]\n\n')
  }
}

export function createFakeUniGate() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url as string, fakeUrl)
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /oauth/authorize': {
          const callback = url.searchParams.get('redirect_uri')
          const state = url.searchParams.get('state')
          if (callback !== `${publicUrl}/api/auth/callback` || !state) {
            return sendJson(res, 400, { error: 'Invalid local callback' })
          }
          const target = new URL(callback)
          target.searchParams.set('state', state)
          target.searchParams.set('code', 'local-authorization-code')
          return redirect(res, target.href)
        }
        case `POST ${oauthPath}/token`:
          req.resume()
          return sendJson(res, 200, {
            access_token: 'local-access-token',
            refresh_token: 'local-refresh-token',
            expires_in: 3600,
          })
        case `GET ${oauthPath}/me`:
          return sendJson(res, 200, { data: account })
        case `POST ${oauthPath}/key`:
          return sendJson(res, 200, { data: { key: 'local-model-key' } })
        case `GET ${oauthPath}/usage`: {
          const page = Number(url.searchParams.get('page')) || 1
          return sendJson(res, 200, {
            data: { items: page === 1 ? [usage] : [], total: 1, page, page_size: 20 },
          })
        }
        case `GET ${oauthPath}/usage/stats`:
          return sendJson(res, 200, { data: { total_actual_cost: usage.actual_cost } })
        case 'GET /v1/models':
          return sendJson(res, 200, { object: 'list', data: models })
        case 'POST /v1/chat/completions': {
          const { model } = await readJson<{ model: string }>(req, modelBodyLimit)
          return await streamReply(res, model)
        }
        default:
          return sendJson(res, 404, { error: 'No local fixture for this endpoint' })
      }
    } catch (error) {
      sendError(res, error)
    }
  })
}

async function localDatabaseUrl() {
  const url = new URL(`postgresql://${loopback}:5432/postgres`)
  url.username = process.env.PGUSER ?? userInfo().username
  url.password = process.env.PGPASSWORD ?? ''
  const admin = new pg.Client({ connectionString: url.href })
  await admin.connect()
  try {
    await createDevelopmentDatabase(admin)
  } finally {
    await admin.end()
  }
  url.pathname = `/${developmentDatabase}`
  return url.href
}

async function startFakeDevelopment() {
  const databaseUrl = await localDatabaseUrl()
  const server = createFakeUniGate().listen(fakePort, loopback)
  await once(server, 'listening')
  const env = {
    ...process.env,
    HOST: loopback,
    PORT: publicPort,
    PUBLIC_URL: publicUrl,
    DATABASE_URL: databaseUrl,
    UNIGATE_CONSOLE_URL: fakeUrl,
    UNIGATE_API_URL: fakeUrl,
    UNIGATE_GATEWAY_URL: `${fakeUrl}/v1`,
    UNIGATE_OAUTH_CLIENT_SECRET: 'local-dev-fixture-not-a-production-secret',
    APP_ENCRYPTION_KEY: Buffer.alloc(32).toString('hex'),
    TAVILY_API_KEY: '',
  }
  const dev = spawn(process.execPath, ['scripts/dev.mjs', '--fake'], { env, stdio: 'inherit' })
  dev.once('exit', (code) => {
    process.exitCode = code ?? 0
    server.close()
  })
  const shutdown = () => {
    dev.kill('SIGTERM')
    server.close()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startFakeDevelopment()
}
