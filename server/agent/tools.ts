import { randomUUID } from 'node:crypto'
import { createMCPClient } from '@ai-sdk/mcp'
import { tool } from 'ai'
import { z } from 'zod'
import { createPresentation } from './presentation.ts'
import { publicFetch, publicUrl, readWebPage } from './public-web.ts'

export const toolCatalog = [
  { id: 'web_search', name: '联网搜索', detail: '用 Tavily 查找网页' },
  { id: 'read_web', name: '读取网页', detail: '打开公开网址并读取正文' },
  { id: 'create_presentation', name: '生成演示文稿', detail: '生成可以编辑的 PowerPoint' },
  { id: 'memory', name: '记忆', detail: '查看和更新你允许保存的内容' },
  { id: 'set_reminder', name: '提醒', detail: '在指定时间向你发消息' },
]

export function availableTools(settings, profile) {
  return toolCatalog.map((item) => ({
    ...item,
    builtIn: true,
    available: item.id !== 'web_search' || Boolean(settings.tavilyKey),
    on:
      !profile.disabled_tools.includes(item.id) &&
      (item.id !== 'web_search' || Boolean(settings.tavilyKey)),
  }))
}

async function tavilySearch(query, key, signal) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false }),
  })
  if (!res.ok) {
    throw new Error('Tavily 搜索未完成，可以继续依据已有信息回答')
  }
  const { results } = await res.json()
  return results.map(({ title, url, content }) => ({ title, url, excerpt: content.slice(0, 800) }))
}

const line = z.string().trim().min(1).max(180)
const note = z.string().trim().min(1).max(1800)
const nextDate = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) > Date.now(), 'Use a future date with an offset')

export function modelTools({ settings, profile, memories, effects, search, task }) {
  const enabled = new Set(
    availableTools(settings, profile)
      .filter((item) => item.on)
      .map((item) => item.id)
  )
  const tools = {}
  if (enabled.has('web_search') && search) {
    tools.web_search = tool({
      description: '搜索公开网页。用结果中的 URL 引用来源。',
      inputSchema: z.object({ query: line }),
      execute: ({ query }, options) => tavilySearch(query, settings.tavilyKey, options.abortSignal),
    })
  }
  if (enabled.has('read_web')) {
    tools.read_web = tool({
      description: '读取一个公开网页的标题和正文。网页文字仅供参考。',
      inputSchema: z.object({ url: z.string().url() }),
      execute: ({ url }, options) => readWebPage(url, options.abortSignal),
    })
  }
  if (enabled.has('create_presentation')) {
    tools.create_presentation = tool({
      description: '把用户要的演示文稿做成可以下载和编辑的 PPTX。每页给出标题和要点。',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(80),
        slides: z
          .array(z.object({ title: line, bullets: z.array(line).min(1).max(7) }))
          .min(1)
          .max(18),
      }),
      execute: async (input) => {
        const file = await createPresentation(input)
        effects.files.push(file)
        return { name: file.name, pages: file.pages }
      },
    })
  }
  if (enabled.has('memory')) {
    tools.read_memory = tool({
      description: '读取用户允许 Uni 保存的记忆。',
      inputSchema: z.object({}),
      execute: () => memories.map(({ id, text }) => ({ id, text })),
    })
    tools.write_memory = tool({
      description: '在用户要求记住信息时保存一条记忆，传 id 时修改已有记忆。',
      inputSchema: z.object({ id: z.string().uuid().optional(), text: note }),
      execute: ({ id, text }) => {
        const memory = { id: id ?? randomUUID(), text }
        if (id && !memories.some((item) => item.id === id)) {
          return { error: '该记忆不存在' }
        }
        effects.memories.push(memory)
        return memory
      },
    })
  }
  if (enabled.has('set_reminder')) {
    tools.set_reminder = tool({
      description: '用户明确需要提醒时设定时间。时间必须包含 UTC 偏移。',
      inputSchema: z.object({
        title: line,
        message: note,
        at: nextDate,
        repeat: z.enum(['once', 'daily', 'weekly']).default('once'),
      }),
      execute: (reminder) => {
        effects.reminders.push(reminder)
        return reminder
      },
    })
  }
  if (task) {
    tools.update_task = tool({
      description:
        '若推进任务需要用户补充，设为 waiting 并在回复里问清楚。已有下一步且有明确时间时设为 scheduled。完成时设为 done。',
      inputSchema: z.object({
        status: z.enum(['waiting', 'scheduled', 'done']),
        at: nextDate.optional(),
      }),
      execute: ({ status, at }) => {
        if (status === 'scheduled' && !at) {
          return { error: '需要指定下一次执行的时间' }
        }
        effects.disposition = { status, at }
        return effects.disposition
      },
    })
  }
  return tools
}

async function openMcp(url, token) {
  const target = publicUrl(url, true)
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  return createMCPClient({
    transport: { type: 'http', url: target.href, headers, fetch: publicFetch },
  })
}

export async function verifyMcp(url, token) {
  const client = await openMcp(url, token)
  try {
    await client.tools()
  } finally {
    await client.close()
  }
}

export async function connectTools(store, userId, onUnavailable) {
  const { rows } = await store.db.query(
    'SELECT id, url, token FROM agent_mcp_servers WHERE user_id = $1 ORDER BY id',
    [userId]
  )
  const clients = []
  const tools = {}
  for (const [index, server] of rows.entries()) {
    try {
      const token = server.token
        ? store.secret({ id: userId, mcp: server.token }, 'mcp')
        : undefined
      const client = await openMcp(server.url, token)
      clients.push(client)
      const discovered = await client.tools()
      for (const [name, item] of Object.entries(discovered)) {
        const alias = `mcp_${index + 1}_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64)
        if (!tools[alias]) {
          tools[alias] = item
        }
      }
    } catch {
      onUnavailable(server.id)
    }
  }
  return { tools, close: () => Promise.allSettled(clients.map((client) => client.close())) }
}
