import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { JsonStore } from './store.js'
import {
  HttpError,
  checkSameOrigin,
  readBody,
  readJson,
  requestFingerprint,
  requireUser,
  sendError,
  sendJson,
  sessionCookie,
} from './http.js'
import {
  createToken,
  encryptSecret,
  hashPassword,
  hashToken,
  publicUser,
  verifyPassword,
} from './security.js'
import { listModels, proxyDeepseek, verifyDeepseekKey } from './model.js'
import {
  billingSnapshot,
  changeCancellation,
  checkout,
  createPortalSession,
  handleStripeWebhook,
} from './billing.js'
import {
  companionSystem,
  ensureWorkspace,
  runPersonalAgent,
  runTask,
  startScheduler,
  validateTask,
} from './workspace.js'
import { validateTool } from './tools.js'

const text = (value, max = 1000) =>
  String(value ?? '')
    .trim()
    .slice(0, max)
const loginAttempts = new Map()

async function createSession(store, userId, res) {
  const token = createToken()
  await store.update((data) => {
    data.sessions = data.sessions.filter((item) => item.expiresAt > Date.now())
    data.sessions.push({
      id: randomUUID(),
      userId,
      tokenHash: hashToken(token),
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
  })
  res.setHeader('Set-Cookie', sessionCookie(token))
}

function requireOwnership(store, userId, collection, id) {
  const item = store.read((data) =>
    data[collection].find((entry) => entry.id === id && entry.userId === userId)
  )
  if (!item) {
    throw new HttpError(404, '内容不存在', 'not_found')
  }
  return item
}

async function apiRoute(req, res, store) {
  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname
  const method = req.method
  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, platformKeyAvailable: Boolean(config.deepseekApiKey) })
  }
  if (pathname === '/api/billing/webhook' && method === 'POST') {
    const raw = await readBody(req, 2 * 1024 * 1024)
    return sendJson(
      res,
      200,
      await handleStripeWebhook(store, raw, req.headers['stripe-signature'])
    )
  }
  if (!['GET', 'HEAD'].includes(method)) {
    checkSameOrigin(req)
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readJson(req)
    const email = text(body.email, 200).toLowerCase()
    const name = text(body.name, 60) || '新朋友'
    const password = String(body.password ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, '请输入有效邮箱')
    }
    if (password.length < 8 || password.length > 200) {
      throw new HttpError(400, '密码长度应为 8–200 位')
    }
    if (store.read((data) => data.users.some((user) => user.email === email))) {
      throw new HttpError(409, '这个邮箱已经注册', 'email_exists')
    }
    const passwordHash = await hashPassword(password)
    const user = await store.update((data) => {
      if (data.users.some((item) => item.email === email)) {
        throw new HttpError(409, '这个邮箱已经注册')
      }
      const created = {
        id: randomUUID(),
        email,
        name,
        passwordHash,
        keyMode: 'platform',
        apiKeyEncrypted: null,
        createdAt: Date.now(),
      }
      data.users.push(created)
      return created
    })
    await ensureWorkspace(store, user.id)
    await createSession(store, user.id, res)
    return sendJson(res, 201, { user: publicUser(user) })
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req)
    const email = text(body.email, 200).toLowerCase()
    const fingerprint = `${requestFingerprint(req)}:${email}`
    const attempts = loginAttempts.get(fingerprint)
    if (attempts?.count >= 20 && Date.now() - attempts.startedAt < 5 * 60_000) {
      throw new HttpError(429, '尝试次数过多，请五分钟后再试')
    }
    const user = store.read((data) => data.users.find((item) => item.email === email))
    const valid = user && (await verifyPassword(String(body.password ?? ''), user.passwordHash))
    if (!valid) {
      loginAttempts.set(
        fingerprint,
        attempts && Date.now() - attempts.startedAt < 5 * 60_000
          ? { ...attempts, count: attempts.count + 1 }
          : { count: 1, startedAt: Date.now() }
      )
      throw new HttpError(401, '邮箱或密码不正确', 'invalid_credentials')
    }
    loginAttempts.delete(fingerprint)
    await ensureWorkspace(store, user.id)
    await createSession(store, user.id, res)
    return sendJson(res, 200, { user: publicUser(user) })
  }

  if (pathname === '/api/auth/demo' && method === 'POST') {
    if (!config.demoMode) {
      throw new HttpError(404, '接口不存在')
    }
    let user = store.read((data) =>
      data.users.find((item) => item.email === 'demo@continuity.local')
    )
    if (!user) {
      const passwordHash = await hashPassword(randomUUID())
      user = await store.update((data) => {
        const created = {
          id: randomUUID(),
          email: 'demo@continuity.local',
          name: '演示用户',
          passwordHash,
          keyMode: 'platform',
          apiKeyEncrypted: null,
          createdAt: Date.now(),
        }
        data.users.push(created)
        return created
      })
      await ensureWorkspace(store, user.id)
    }
    await createSession(store, user.id, res)
    return sendJson(res, 200, { user: publicUser(user) })
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const user = await requireUser(req, store)
    const tokenHash = hashToken(
      (req.headers.cookie ?? '').match(/continuity_session=([^;]+)/)?.[1] ?? ''
    )
    await store.update((data) => {
      data.sessions = data.sessions.filter((item) => item.tokenHash !== tokenHash)
    })
    res.setHeader('Set-Cookie', sessionCookie('', 0))
    return sendJson(res, 200, { ok: true, userId: user.id })
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const { authenticate } = await import('./http.js')
    const user = await authenticate(req, store)
    if (user) {
      await ensureWorkspace(store, user.id)
    }
    return sendJson(res, 200, { user: user ? publicUser(user) : null })
  }

  const user = await requireUser(req, store)
  if (pathname === '/api/provider' && method === 'GET') {
    const models = await listModels(user)
    return sendJson(res, 200, {
      name: config.modelApiFormat === 'openai' ? 'Unigate' : 'DeepSeek',
      apiFormat: config.modelApiFormat,
      models,
      selectedModel: user.selectedModel ?? config.defaultModel,
      capabilities:
        config.modelApiFormat === 'openai'
          ? { thinking: false, search: false, attachments: false, speech: false }
          : { thinking: true, search: true, attachments: true, speech: true },
    })
  }
  if (pathname === '/api/provider/model' && method === 'PUT') {
    const body = await readJson(req)
    const selectedModel = text(body.model, 100)
    if (!/^[\w.:@/-]+$/.test(selectedModel)) {
      throw new HttpError(400, '模型 ID 格式无效')
    }
    await store.update((data) => {
      data.users.find((item) => item.id === user.id).selectedModel = selectedModel
    })
    return sendJson(res, 200, { selectedModel })
  }
  if (pathname.startsWith('/api/deepseek/')) {
    return proxyDeepseek(req, res, user)
  }

  if (pathname === '/api/settings/key' && method === 'PUT') {
    const body = await readJson(req)
    const mode = body.mode === 'byok' ? 'byok' : 'platform'
    const apiKey = text(body.apiKey, 300)
    if (mode === 'platform' && !config.deepseekApiKey) {
      throw new HttpError(503, '平台 API Key 尚未配置，请使用自有 API Key', 'platform_key_missing')
    }
    if (mode === 'byok' && apiKey) {
      await verifyDeepseekKey({ ...user, keyMode: 'byok' }, apiKey)
    } else if (mode === 'byok' && !user.apiKeyEncrypted) {
      throw new HttpError(400, '请输入 API Key')
    }
    const encrypted = apiKey && mode === 'byok' ? await encryptSecret(apiKey) : null
    const updated = await store.update((data) => {
      const current = data.users.find((item) => item.id === user.id)
      current.keyMode = mode
      if (encrypted) {
        current.apiKeyEncrypted = encrypted
      }
      return current
    })
    return sendJson(res, 200, { user: publicUser(updated) })
  }

  if (pathname === '/api/workspace' && method === 'GET') {
    return sendJson(
      res,
      200,
      store.read((data) => ({
        profile: data.profiles[user.id],
        agentProfile: data.agentProfiles[user.id],
        tools: data.tools[user.id] ?? [],
      }))
    )
  }

  if (pathname === '/api/companion/prompt' && method === 'GET') {
    return sendJson(res, 200, companionSystem(store, user.id))
  }

  if (pathname === '/api/soul' && method === 'PUT') {
    const body = await readJson(req)
    const soul = {
      companionName: text(body.companionName, 60) || '小续',
      userName: text(body.userName, 60),
      relationship: text(body.relationship, 100),
      personality: text(body.personality, 1000),
      speakingStyle: text(body.speakingStyle, 1000),
      boundaries: text(body.boundaries, 1000),
      customInstructions: text(body.customInstructions, 5000),
    }
    const profile = await store.update((data) => {
      data.profiles[user.id].soul = soul
      if (body.proactive) {
        const quietStart = text(body.proactive.quietStart, 5)
        const quietEnd = text(body.proactive.quietEnd, 5)
        if (
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietStart) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietEnd)
        ) {
          throw new HttpError(400, '免打扰时间无效')
        }
        data.profiles[user.id].proactive = {
          enabled: body.proactive.enabled !== false,
          quietStart,
          quietEnd,
        }
      }
      return data.profiles[user.id]
    })
    return sendJson(res, 200, { profile })
  }

  if (pathname === '/api/memories' && method === 'POST') {
    const body = await readJson(req)
    const content = text(body.content, 1000)
    if (!content) {
      throw new HttpError(400, '记忆内容不能为空')
    }
    const memory = await store.update((data) => {
      const created = {
        id: randomUUID(),
        content,
        category: text(body.category, 30) || '其他',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      data.profiles[user.id].memories.push(created)
      return created
    })
    return sendJson(res, 201, { memory })
  }

  const memoryMatch = pathname.match(/^\/api\/memories\/([\w-]+)$/)
  if (memoryMatch && method === 'PATCH') {
    const body = await readJson(req)
    const memory = await store.update((data) => {
      const item = data.profiles[user.id].memories.find((entry) => entry.id === memoryMatch[1])
      if (!item) {
        throw new HttpError(404, '记忆不存在')
      }
      if (body.content !== undefined) {
        item.content = text(body.content, 1000)
      }
      if (!item.content) {
        throw new HttpError(400, '记忆内容不能为空')
      }
      if (body.category !== undefined) {
        item.category = text(body.category, 30) || '其他'
      }
      if (body.enabled !== undefined) {
        item.enabled = Boolean(body.enabled)
      }
      item.updatedAt = Date.now()
      return item
    })
    return sendJson(res, 200, { memory })
  }
  if (memoryMatch && method === 'DELETE') {
    await store.update((data) => {
      data.profiles[user.id].memories = data.profiles[user.id].memories.filter(
        (item) => item.id !== memoryMatch[1]
      )
    })
    return sendJson(res, 200, { ok: true })
  }

  if (pathname === '/api/tools' && method === 'POST') {
    const body = await readJson(req)
    const valid = validateTool(body)
    const tool = await store.update((data) => {
      if (data.tools[user.id].some((item) => item.name === valid.name)) {
        throw new HttpError(409, '工具名称已存在')
      }
      const created = { id: randomUUID(), ...valid }
      data.tools[user.id].push(created)
      return created
    })
    return sendJson(res, 201, { tool })
  }
  const toolMatch = pathname.match(/^\/api\/tools\/([\w-]+)$/)
  if (toolMatch && method === 'PATCH') {
    const body = await readJson(req)
    const tool = await store.update((data) => {
      const existing = data.tools[user.id].find((item) => item.id === toolMatch[1])
      if (!existing) {
        throw new HttpError(404, '工具不存在')
      }
      const valid = validateTool({
        ...existing,
        ...body,
        config: { ...existing.config, ...body.config },
      })
      if (data.tools[user.id].some((item) => item.id !== existing.id && item.name === valid.name)) {
        throw new HttpError(409, '工具名称已存在')
      }
      Object.assign(existing, valid)
      return existing
    })
    return sendJson(res, 200, { tool })
  }
  if (toolMatch && method === 'DELETE') {
    await store.update((data) => {
      data.tools[user.id] = data.tools[user.id].filter((item) => item.id !== toolMatch[1])
    })
    return sendJson(res, 200, { ok: true })
  }

  if (pathname === '/api/agent' && method === 'GET') {
    return sendJson(
      res,
      200,
      store.read((data) => ({
        profile: data.agentProfiles[user.id],
        messages: data.agentMessages.filter((item) => item.userId === user.id).slice(-100),
      }))
    )
  }
  if (pathname === '/api/agent/profile' && method === 'PUT') {
    const body = await readJson(req)
    const profile = await store.update((data) => {
      const current = data.agentProfiles[user.id]
      current.name = text(body.name, 60) || 'Personal Agent'
      current.mission = text(body.mission, 3000)
      current.instructions = text(body.instructions, 5000)
      current.autonomy = body.autonomy === 'auto' ? 'auto' : 'confirm'
      return current
    })
    return sendJson(res, 200, { profile })
  }
  if (pathname === '/api/agent/run' && method === 'POST') {
    const body = await readJson(req)
    const message = await runPersonalAgent(store, user, body.input)
    return sendJson(res, 200, { message })
  }

  if (pathname === '/api/tasks' && method === 'GET') {
    return sendJson(res, 200, {
      tasks: store.read((data) => data.tasks.filter((item) => item.userId === user.id)),
    })
  }
  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await readJson(req)
    const task = await store.update((data) => {
      const created = {
        id: randomUUID(),
        userId: user.id,
        createdAt: Date.now(),
        ...validateTask(body),
      }
      data.tasks.push(created)
      return created
    })
    return sendJson(res, 201, { task })
  }
  const taskRunMatch = pathname.match(/^\/api\/tasks\/([\w-]+)\/run$/)
  if (taskRunMatch && method === 'POST') {
    requireOwnership(store, user.id, 'tasks', taskRunMatch[1])
    return sendJson(res, 200, await runTask(store, taskRunMatch[1], true))
  }
  const taskMatch = pathname.match(/^\/api\/tasks\/([\w-]+)$/)
  if (taskMatch && method === 'PATCH') {
    const body = await readJson(req)
    const task = await store.update((data) => {
      const existing = data.tasks.find(
        (item) => item.id === taskMatch[1] && item.userId === user.id
      )
      if (!existing) {
        throw new HttpError(404, '任务不存在')
      }
      const valid = validateTask({ ...existing, ...body })
      Object.assign(existing, valid, { updatedAt: Date.now() })
      return existing
    })
    return sendJson(res, 200, { task })
  }
  if (taskMatch && method === 'DELETE') {
    await store.update((data) => {
      data.tasks = data.tasks.filter((item) => item.id !== taskMatch[1] || item.userId !== user.id)
    })
    return sendJson(res, 200, { ok: true })
  }

  if (pathname === '/api/outbox' && method === 'GET') {
    return sendJson(res, 200, {
      messages: store.read((data) =>
        data.outbox
          .filter((item) => item.userId === user.id)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 50)
      ),
    })
  }
  if (pathname === '/api/outbox/ack' && method === 'POST') {
    const body = await readJson(req)
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : []
    await store.update((data) => {
      data.outbox.forEach((item) => {
        if (item.userId === user.id && ids.includes(item.id)) {
          item.read = true
        }
      })
    })
    return sendJson(res, 200, { ok: true })
  }

  if (pathname === '/api/billing' && method === 'GET') {
    return sendJson(res, 200, billingSnapshot(store, user.id))
  }
  if (pathname === '/api/billing/checkout' && method === 'POST') {
    const body = await readJson(req)
    return sendJson(res, 200, await checkout(store, user, text(body.planId, 30)))
  }
  if (pathname === '/api/billing/cancel' && method === 'POST') {
    return sendJson(res, 200, { subscription: await changeCancellation(store, user, true) })
  }
  if (pathname === '/api/billing/resume' && method === 'POST') {
    return sendJson(res, 200, { subscription: await changeCancellation(store, user, false) })
  }
  if (pathname === '/api/billing/portal' && method === 'POST') {
    return sendJson(res, 200, { url: await createPortalSession(user) })
  }
  throw new HttpError(404, '接口不存在', 'not_found')
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

async function serveStatic(res, pathname) {
  const dist = path.join(config.root, 'dist')
  let file = path.resolve(dist, `.${decodeURIComponent(pathname)}`)
  if (!file.startsWith(`${dist}${path.sep}`) && file !== dist) {
    throw new HttpError(403, '路径无效')
  }
  try {
    if ((await stat(file)).isDirectory()) {
      file = path.join(file, 'index.html')
    }
  } catch {
    file = path.join(dist, 'index.html')
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    })
    res.end(body)
  } catch {
    throw new HttpError(404, '页面不存在，请先运行 pnpm build')
  }
}

export async function createApplication() {
  const store = new JsonStore(config.dataDir)
  await store.init()
  const server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        await apiRoute(req, res, store)
      } else if (['GET', 'HEAD'].includes(req.method)) {
        await serveStatic(res, new URL(req.url, 'http://localhost').pathname)
      } else {
        throw new HttpError(404, '页面不存在')
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy()
      } else {
        sendError(res, error)
      }
    }
  })
  const scheduler = startScheduler(store)
  return { server, store, scheduler }
}

async function main() {
  const { server } = await createApplication()
  server.listen(config.port, () => {
    process.stdout.write(`Continuity server listening on ${config.publicUrl}\n`)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
