import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentState } from '../../contract/types.ts'
import type { Config } from '../config.ts'
import type { PostgresStore } from '../store.ts'
import type { AttachmentInput, Db, DialogueMessage, Services, UserRow } from '../types.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { newAttachment } from '../archive.ts'
import { modelOf, uuidPattern } from '../conversations.ts'
import { HttpError, readJson, sendJson } from '../http.ts'
import { publicUrl } from './public-web.ts'
import { agentMemories, agentProfile, listAgentState, saveMemory } from './repository.ts'
import { availableTools, toolCatalog, verifyMcp } from './tools.ts'

const profilePatch = z.object({
  name: z.string().trim().min(1).max(28).optional(),
  persona: z.string().max(3000).optional(),
  proactive: z.boolean().optional(),
  timezone: z
    .string()
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format()
        return true
      } catch {
        return false
      }
    })
    .optional(),
  disabledTools: z.array(z.enum(toolCatalog.map((item) => item.id))).optional(),
})
const textSchema = z.string().trim().min(1).max(8_000)

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new HttpError(400, '内容格式无效，请检查输入', 'invalid_agent_input')
  }
  return parsed.data
}

async function agentState(
  store: PostgresStore,
  user: UserRow,
  settings: Config
): Promise<AgentState<Date>> {
  const profile = await agentProfile(store.db, user.id)
  const [state, memories, mcps] = await Promise.all([
    listAgentState(store.db, user.id),
    agentMemories(store.db, user.id),
    store.db.query<{ id: string; url: string }>(
      'SELECT id,url FROM agent_mcp_servers WHERE user_id = $1 ORDER BY id',
      [user.id]
    ),
  ])
  return {
    ...state,
    memories,
    mcpServers: mcps.rows,
    profile: {
      name: profile.name,
      persona: profile.persona,
      proactive: profile.proactive,
      timezone: profile.timezone,
    },
    tools: availableTools(settings, profile),
  }
}

async function agentFile(res: ServerResponse, db: Db, userId: string, id: string) {
  const { rows } = await db.query<{ name: string; content: Buffer }>(
    'SELECT name,content FROM agent_files WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  const file = rows[0]
  if (!file) {
    throw new HttpError(404, '文件不存在', 'not_found')
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'Content-Length': file.content.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(file.content)
}

type SendInput = {
  text: unknown
  model: unknown
  messageId: string
  taskId?: string
  files?: AttachmentInput[]
}

export async function routeAgent(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  user: UserRow,
  { store, settings, agent }: Services
) {
  const db = store.db
  const method = req.method
  if (method === 'GET' && path === '/api/agent') {
    return sendJson(res, 200, await agentState(store, user, settings))
  }
  if (method === 'POST' && path === '/api/agent/messages') {
    const body = await readJson<SendInput>(req, 16 * 1024 * 1024)
    const text = validate(textSchema, body.text)
    const model = modelOf(body.model)
    if (
      !model ||
      !uuidPattern.test(body.messageId) ||
      (body.taskId && !uuidPattern.test(body.taskId))
    ) {
      throw new HttpError(400, '请先选择可用模型', 'invalid_agent_input')
    }
    const files = Array.isArray(body.files) ? body.files.slice(0, 8).map(newAttachment) : []
    const context: DialogueMessage[] = files.length
      ? [
          {
            role: 'user',
            content: files.map((file) =>
              file.type.startsWith('image/')
                ? {
                    type: 'image_url',
                    image_url: { url: `data:${file.type};base64,${file.data.toString('base64')}` },
                  }
                : { type: 'text', text: `${file.name}\n${file.data.toString('utf8')}` }
            ),
          },
        ]
      : []
    const result = await agent.send(user, {
      text,
      model,
      messageId: body.messageId,
      taskId: body.taskId,
      context,
    })
    return sendJson(res, 202, result)
  }
  if (method === 'PATCH' && path === '/api/agent/profile') {
    const profile = validate(profilePatch, await readJson(req))
    await agentProfile(db, user.id)
    await db.query(
      `
      UPDATE agent_profiles SET name = coalesce($2, name), persona = coalesce($3, persona),
        proactive = coalesce($4, proactive), timezone = coalesce($5, timezone),
        disabled_tools = coalesce($6, disabled_tools)
      WHERE user_id = $1
    `,
      [
        user.id,
        profile.name,
        profile.persona,
        profile.proactive,
        profile.timezone,
        profile.disabledTools,
      ]
    )
    return sendJson(res, 200, await agentState(store, user, settings))
  }
  if (method === 'POST' && path === '/api/agent/memories') {
    const body = await readJson(req)
    const text = validate(textSchema.max(1800), body.text)
    await saveMemory(db, user.id, { id: randomUUID(), text }, '手动添加')
    return sendJson(res, 201, await agentMemories(db, user.id))
  }
  if (method === 'POST' && path === '/api/agent/mcp') {
    const body = await readJson(req)
    let url
    try {
      url = publicUrl(validate(z.string().max(1024), body.url), true).href
    } catch {
      throw new HttpError(400, '请输入公开的 HTTPS MCP 服务地址', 'invalid_mcp_url')
    }
    const token = validate(z.string().max(4096).optional(), body.token)
    try {
      await verifyMcp(url, token)
    } catch {
      throw new HttpError(400, 'MCP 连接未完成，请核对服务地址和凭证', 'mcp_unavailable')
    }
    await db.query(
      `
      INSERT INTO agent_mcp_servers (id,user_id,url,token) VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id,url) DO UPDATE SET token = excluded.token
    `,
      [randomUUID(), user.id, url, token ? store.seal(user.id, 'mcp', token) : null]
    )
    return sendJson(res, 201, { ok: true })
  }

  const match = /^\/api\/agent\/(memories|mcp|files|reminders)\/([^/]+)$/.exec(path)
  if (match && uuidPattern.test(match[2])) {
    const [, kind, id] = match
    if (kind === 'memories' && method === 'PATCH') {
      const text = validate(textSchema.max(1800), (await readJson(req)).text)
      await db.query('UPDATE agent_memories SET body = $3 WHERE user_id = $1 AND id = $2', [
        user.id,
        id,
        text,
      ])
      return sendJson(res, 200, await agentMemories(db, user.id))
    }
    if (kind === 'memories' && method === 'DELETE') {
      await db.query('DELETE FROM agent_memories WHERE user_id = $1 AND id = $2', [user.id, id])
      return sendJson(res, 200, await agentMemories(db, user.id))
    }
    if (kind === 'mcp' && method === 'DELETE') {
      await db.query('DELETE FROM agent_mcp_servers WHERE user_id = $1 AND id = $2', [user.id, id])
      return sendJson(res, 200, { ok: true })
    }
    if (kind === 'files' && method === 'GET') {
      return agentFile(res, db, user.id, id)
    }
    if (kind === 'reminders' && method === 'PATCH') {
      const enabled = validate(z.boolean(), (await readJson(req)).enabled)
      const query = await db.query(
        'UPDATE agent_tasks SET enabled = $3 WHERE id = $2 AND user_id = $1 AND reminder IS NOT NULL AND state = $4',
        [user.id, id, enabled, 'scheduled']
      )
      if (!query.rowCount) {
        throw new HttpError(404, '该提醒已经结束', 'not_found')
      }
      return sendJson(res, 200, { ok: true })
    }
  }
  throw new HttpError(404, '请求的接口不存在', 'not_found')
}
