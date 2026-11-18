import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { HttpError } from './http.js'

const toolSchemas = {
  current_time: {
    type: 'object',
    properties: { timezone: { type: 'string', description: 'IANA 时区，例如 Asia/Shanghai' } },
  },
  calculator: {
    type: 'object',
    properties: { expression: { type: 'string', description: '需要计算的数学表达式' } },
    required: ['expression'],
  },
  read_url: {
    type: 'object',
    properties: { url: { type: 'string', description: '公开网页的 http(s) 地址' } },
    required: ['url'],
  },
  webhook: {
    type: 'object',
    properties: { input: { type: 'string', description: '发送给自定义服务的输入' } },
    required: ['input'],
  },
}

export const toolDefinition = (tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: toolSchemas[tool.type] ?? tool.config.inputSchema ?? toolSchemas.webhook,
})

const isPrivateAddress = (address) => {
  if (address === '::1' || address.startsWith('fe80:')) {
    return true
  }
  if (address.startsWith('::ffff:')) {
    address = address.slice(7)
  }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  )
}

async function publicUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('只支持 HTTP(S) 地址')
  }
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('不允许访问内网地址')
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error('不允许访问内网地址')
    }
  } else {
    const records = await lookup(hostname, { all: true })
    if (records.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('不允许访问内网地址')
    }
  }
  return url
}

async function fetchPublic(value, init = {}, redirects = 0) {
  const url = await publicUrl(value)
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'ContinuityChat/0.1', ...init.headers },
  })
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    if (redirects >= 3) {
      throw new Error('网页重定向次数过多')
    }
    return fetchPublic(new URL(response.headers.get('location'), url), init, redirects + 1)
  }
  if (!response.ok) {
    throw new Error(`网页返回 ${response.status}`)
  }
  const text = await response.text()
  return { response, text: text.slice(0, 200_000) }
}

const decodeEntities = (text) =>
  text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const table = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    if (entity[0] === '#') {
      const value =
        entity[1]?.toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : _
    }
    return table[entity.toLowerCase()] ?? _
  })

class Calculator {
  constructor(expression) {
    this.tokens = expression.match(/\d+(?:\.\d+)?|[a-z_]+|[()+\-*/%^,]/gi) ?? []
    this.index = 0
  }

  peek() {
    return this.tokens[this.index]
  }
  take() {
    return this.tokens[this.index++]
  }

  parse() {
    const value = this.expression()
    if (this.index !== this.tokens.length) {
      throw new Error('表达式格式不正确')
    }
    if (!Number.isFinite(value)) {
      throw new Error('计算结果无效')
    }
    return value
  }

  expression() {
    let value = this.term()
    while (['+', '-'].includes(this.peek())) {
      const operator = this.take()
      const right = this.term()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  term() {
    let value = this.power()
    while (['*', '/', '%'].includes(this.peek())) {
      const operator = this.take()
      const right = this.power()
      if (operator === '*') {
        value *= right
      }
      if (operator === '/') {
        value /= right
      }
      if (operator === '%') {
        value %= right
      }
    }
    return value
  }

  power() {
    const value = this.unary()
    return this.peek() === '^' ? (this.take(), value ** this.power()) : value
  }

  unary() {
    if (this.peek() === '-') {
      return (this.take(), -this.unary())
    }
    if (this.peek() === '+') {
      return (this.take(), this.unary())
    }
    return this.primary()
  }

  primary() {
    const token = this.take()
    if (token === '(') {
      const value = this.expression()
      if (this.take() !== ')') {
        throw new Error('括号不匹配')
      }
      return value
    }
    if (/^\d/.test(token ?? '')) {
      return Number(token)
    }
    const functions = {
      sqrt: Math.sqrt,
      abs: Math.abs,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      min: Math.min,
      max: Math.max,
      pow: Math.pow,
    }
    if (token === 'pi') {
      return Math.PI
    }
    if (token === 'e') {
      return Math.E
    }
    const fn = functions[token?.toLowerCase()]
    if (!fn || this.take() !== '(') {
      throw new Error('不支持的函数或常量')
    }
    const args = []
    if (this.peek() !== ')') {
      do {
        args.push(this.expression())
      } while (this.peek() === ',' && this.take())
    }
    if (this.take() !== ')') {
      throw new Error('函数括号不匹配')
    }
    return fn(...args)
  }
}

export async function executeTool(tool, input) {
  if (tool.type === 'current_time') {
    const timezone = input.timezone || 'Asia/Shanghai'
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone: timezone,
    }).format(new Date())
  }
  if (tool.type === 'calculator') {
    if (typeof input.expression !== 'string' || input.expression.length > 200) {
      throw new Error('表达式为空或过长')
    }
    return String(new Calculator(input.expression).parse())
  }
  if (tool.type === 'read_url') {
    const { response, text } = await fetchPublic(String(input.url ?? ''))
    const contentType = response.headers.get('content-type') ?? ''
    if (!/text|json|xml|csv|markdown/.test(contentType)) {
      throw new Error('网页内容不是可读文本')
    }
    const clean = contentType.includes('html')
      ? decodeEntities(
          text
            .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
        )
      : text
    return clean.slice(0, 50_000)
  }
  if (tool.type === 'webhook') {
    const { text } = await fetchPublic(tool.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: input.input ?? input }),
    })
    return text
  }
  throw new Error(`不支持的工具：${tool.type}`)
}

export const validateTool = (body) => {
  const type = String(body.type ?? '')
  if (!Object.hasOwn(toolSchemas, type)) {
    throw new HttpError(400, '工具类型无效')
  }
  const name = String(body.name ?? '').trim()
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) {
    throw new HttpError(400, '工具名称需以字母开头，只包含字母、数字和下划线')
  }
  const description = String(body.description ?? '')
    .trim()
    .slice(0, 500)
  if (!description) {
    throw new HttpError(400, '请填写工具说明')
  }
  const config = type === 'webhook' ? { url: String(body.config?.url ?? '') } : {}
  if (type === 'webhook') {
    const url = new URL(config.url)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new HttpError(400, 'Webhook 地址无效')
    }
  }
  return { type, name, description, enabled: body.enabled !== false, config }
}
