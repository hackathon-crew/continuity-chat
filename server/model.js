import { Readable } from 'node:stream'
import { config } from './config.js'
import { HttpError, readBody, sendJson } from './http.js'
import { decryptSecret } from './security.js'
import { executeTool, toolDefinition } from './tools.js'

const openAICompatible = () => config.modelApiFormat === 'openai'
const selectedModel = (user) => user.selectedModel || config.defaultModel

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

async function upstreamModels(user) {
  const key = await apiKeyFor(user)
  const response = await fetch(`${config.deepseekApiBase}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new HttpError(400, result?.error?.message ?? 'API Key 校验失败', 'invalid_api_key')
  }
  return result
}

export async function verifyDeepseekKey(user, suppliedKey) {
  await upstreamModels({ ...user, selectedModel: undefined }, suppliedKey)
}

export async function listModels(user) {
  const result = await upstreamModels(user)
  const models = [...new Set((result.data ?? []).map((item) => item.id).filter(Boolean))].sort()
  return models.length ? models : [selectedModel(user)]
}

function textContent(content) {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function toOpenAIMessages(messages, system) {
  const result = system ? [{ role: 'system', content: system }] : []
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      result.push({ role: 'system', content: message.content })
      continue
    }
    if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content) ? message.content : []
      const toolCalls = blocks.filter((block) => block.type === 'tool_use')
      const output = {
        role: 'assistant',
        content: textContent(message.content) || (toolCalls.length ? null : ''),
      }
      if (toolCalls.length) {
        output.tool_calls = toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
        }))
      }
      result.push(output)
      continue
    }
    const blocks = Array.isArray(message.content) ? message.content : []
    const toolResults = blocks.filter((block) => block.type === 'tool_result')
    if (toolResults.length) {
      for (const toolResult of toolResults) {
        result.push({
          role: 'tool',
          tool_call_id: toolResult.tool_use_id,
          content: textContent(toolResult.content),
        })
      }
      continue
    }
    result.push({ role: 'user', content: textContent(message.content) })
  }
  return result
}

function openAITools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

function usageFromOpenAI(usage) {
  if (!usage) {
    return undefined
  }
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

function fromOpenAIResponse(result) {
  const choice = result.choices?.[0]
  const message = choice?.message ?? {}
  const content = []
  if (message.content) {
    content.push({ type: 'text', text: message.content })
  }
  for (const call of message.tool_calls ?? []) {
    let input = {}
    try {
      input = JSON.parse(call.function.arguments || '{}')
    } catch {
      input = { raw: call.function.arguments }
    }
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
  }
  const finish = choice?.finish_reason
  return {
    content,
    stop_reason:
      finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn',
    usage: usageFromOpenAI(result.usage),
  }
}

async function callOpenAI(user, { system, messages, tools, maxTokens }) {
  const key = await apiKeyFor(user)
  const response = await fetch(`${config.deepseekApiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: selectedModel(user),
      messages: toOpenAIMessages(messages, system),
      max_tokens: maxTokens,
      stream: false,
      ...(tools.length ? { tools: openAITools(tools), tool_choice: 'auto' } : {}),
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
  return fromOpenAIResponse(result)
}

export async function callModel(user, { system, messages, tools = [], maxTokens = 1800 }) {
  if (openAICompatible()) {
    return callOpenAI(user, { system, messages, tools, maxTokens })
  }
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
      model: selectedModel(user),
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

const eventData = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const stopReason = (reason) =>
  reason === 'length' ? 'max_tokens' : reason === 'tool_calls' ? 'tool_use' : 'end_turn'

function titleFromRequest(body) {
  const first = body.messages?.find((message) => message.role === 'user')
  return textContent(first?.content).replace(/\s+/g, ' ').trim().slice(0, 28) || '新对话'
}

async function proxyOpenAIChat(req, res, user, key) {
  const raw = await readBody(req, 30 * 1024 * 1024)
  const input = JSON.parse(raw.toString('utf8'))
  const messages = toOpenAIMessages(input.messages ?? [], input.system)
  if (
    input.messages?.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => ['image', 'document'].includes(block.type))
    )
  ) {
    throw new HttpError(
      400,
      '当前 Unigate 文本接口不支持附件，请切换到 DeepSeek 官方提供方',
      'attachments_unsupported'
    )
  }
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort()
    }
  })
  const upstream = await fetch(`${config.deepseekApiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: selectedModel(user),
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: input.max_tokens ?? 4096,
    }),
    signal: controller.signal,
  })
  if (!upstream.ok) {
    const result = await upstream.json().catch(() => null)
    return sendJson(res, upstream.status, {
      error: { message: result?.error?.message ?? `模型服务返回 ${upstream.status}` },
    })
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  let blockOpen = false
  let blockType = 'text'
  let blockIndex = 0
  let finish = 'stop'
  let usage
  const write = (event, data) => res.write(eventData(event, data))
  const closeBlock = () => {
    if (blockOpen) {
      write('content_block_stop', { type: 'content_block_stop', index: blockIndex })
    }
    blockOpen = false
  }
  const startBlock = (type) => {
    closeBlock()
    blockType = type
    blockOpen = true
    write('content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: type === 'text' ? { type, text: '' } : { type, thinking: '', signature: '' },
    })
  }
  write('message_start', {
    type: 'message_start',
    message: { id: upstream.headers.get('x-request-id') ?? 'unigate', model: selectedModel(user) },
  })
  try {
    let buffer = ''
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      buffer += chunk.toString()
      const packets = buffer.split(/\r?\n\r?\n/)
      buffer = packets.pop() ?? ''
      for (const packet of packets) {
        const data = packet
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (!data) {
          continue
        }
        if (data === '[DONE]') {
          continue
        }
        const payload = JSON.parse(data)
        if (payload.error) {
          throw new Error(payload.error.message ?? '上游流式请求失败')
        }
        usage = payload.usage ?? usage
        for (const choice of payload.choices ?? []) {
          const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning
          const content =
            typeof choice.delta?.content === 'string'
              ? choice.delta.content
              : (choice.delta?.content?.map((part) => part.text ?? '').join('') ?? '')
          if (reasoning && input.thinking?.type === 'enabled') {
            if (!blockOpen || blockType !== 'thinking') {
              startBlock('thinking')
            }
            write('content_block_delta', {
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'thinking_delta', thinking: reasoning },
            })
          }
          if (content) {
            if (!blockOpen || blockType !== 'text') {
              startBlock('text')
            }
            write('content_block_delta', {
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'text_delta', text: content },
            })
          }
          if (choice.finish_reason) {
            finish = choice.finish_reason
          }
        }
      }
    }
    closeBlock()
    write('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason(finish),
        stop_sequence: null,
        ...(input.title?.enabled ? { title: titleFromRequest(input) } : {}),
      },
      ...(usageFromOpenAI(usage) ? { usage: usageFromOpenAI(usage) } : {}),
    })
    res.end(eventData('message_stop', { type: 'message_stop' }))
  } catch (error) {
    if (!controller.signal.aborted) {
      closeBlock()
      res.end(eventData('error', { type: 'error', error: { message: error.message } }))
    }
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
  if (openAICompatible() && path === '/anthropic/v1/messages') {
    return proxyOpenAIChat(req, res, user, key)
  }
  if (openAICompatible() && path !== '/models') {
    throw new HttpError(400, '当前模型提供方不支持此能力', 'capability_unsupported')
  }
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
