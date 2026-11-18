import { Readable } from 'node:stream'
import { config } from './config.js'
import { HttpError, readBody } from './http.js'
import { decryptSecret } from './security.js'
import { executeTool, toolDefinition } from './tools.js'

async function apiKeyFor(user, suppliedKey) {
  if (user.keyMode === 'platform') {
    if (!config.deepseekApiKey) {
      throw new HttpError(
        503,
        '平台 API Key 尚未配置，请切换为自有 API Key',
        'platform_key_missing'
      )
    }
    return config.deepseekApiKey
  }
  if (suppliedKey && !['stored', 'platform'].includes(suppliedKey)) {
    return suppliedKey
  }
  if (!user.apiKeyEncrypted) {
    throw new HttpError(400, '请先在设置中填写 API Key', 'api_key_missing')
  }
  return decryptSecret(user.apiKeyEncrypted)
}

export async function verifyDeepseekKey(user, suppliedKey) {
  const key = await apiKeyFor(user, suppliedKey)
  const response = await fetch(`${config.deepseekApiBase}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new HttpError(400, 'API Key 校验失败，请检查后重试', 'invalid_api_key')
  }
}

export async function proxyDeepseek(req, res, user) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname.slice('/api/deepseek'.length)
  const allowed =
    path === '/models' ||
    path === '/anthropic/v1/messages' ||
    path === '/anthropic/v1/files' ||
    /^\/anthropic\/v1\/files\/[\w-]+$/.test(path)
  if (!allowed) {
    throw new HttpError(404, '接口不存在', 'not_found')
  }
  const authorization = req.headers.authorization
  const suppliedKey =
    req.headers['x-api-key'] ?? (authorization?.startsWith('Bearer ') ? authorization.slice(7) : '')
  const key = await apiKeyFor(user, suppliedKey)
  const body = ['GET', 'HEAD'].includes(req.method)
    ? undefined
    : await readBody(req, 30 * 1024 * 1024)
  const headers = {
    'x-api-key': key,
    Authorization: `Bearer ${key}`,
    Accept: req.headers.accept ?? '*/*',
  }
  for (const name of ['content-type', 'anthropic-beta', 'anthropic-version']) {
    if (req.headers[name]) {
      headers[name] = req.headers[name]
    }
  }
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort()
    }
  })
  const upstream = await fetch(`${config.deepseekApiBase}${path}${url.search}`, {
    method: req.method,
    headers,
    body,
    signal: controller.signal,
  })
  const responseHeaders = {}
  for (const name of ['content-type', 'cache-control', 'x-ds-request-id', 'retry-after']) {
    const value = upstream.headers.get(name)
    if (value) {
      responseHeaders[name] = value
    }
  }
  res.writeHead(upstream.status, responseHeaders)
  if (!upstream.body) {
    return res.end()
  }
  const stream = Readable.fromWeb(upstream.body)
  stream.on('error', (error) => {
    if (!controller.signal.aborted) {
      res.destroy(error)
    }
  })
  stream.pipe(res)
}

export async function callModel(user, { system, messages, tools = [], maxTokens = 1800 }) {
  const key = await apiKeyFor(user)
  const response = await fetch(`${config.deepseekApiBase}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      Authorization: `Bearer ${key}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'deepseek-flash',
      system,
      messages,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      safety_check: { level: 'high' },
      ...(tools.length ? { tools } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new HttpError(
      502,
      result?.error?.message ?? `模型服务返回 ${response.status}`,
      'model_error'
    )
  }
  return result
}

export async function runToolAgent(user, { system, messages, tools }) {
  const trace = []
  const definitions = tools.map(toolDefinition)
  const rounds = [...messages]
  for (let step = 0; step < 5; step += 1) {
    const result = await callModel(user, { system, messages: rounds, tools: definitions })
    const content = Array.isArray(result.content) ? result.content : []
    rounds.push({ role: 'assistant', content })
    const calls = content.filter((block) => block.type === 'tool_use')
    if (result.stop_reason !== 'tool_use' || calls.length === 0) {
      return {
        text: content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n'),
        trace,
        usage: result.usage,
      }
    }
    const results = []
    for (const call of calls) {
      const tool = tools.find((item) => item.name === call.name)
      let output
      try {
        output = tool ? await executeTool(tool, call.input ?? {}) : '工具不存在或已停用'
      } catch (error) {
        output = `工具执行失败：${error.message}`
      }
      trace.push({
        name: call.name,
        input: call.input ?? {},
        output: String(output).slice(0, 5000),
      })
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: [{ type: 'text', text: String(output).slice(0, 50_000) }],
      })
    }
    rounds.push({ role: 'user', content: results })
  }
  throw new HttpError(502, '工具调用轮次过多，请缩小任务范围后重试', 'tool_loop_limit')
}
