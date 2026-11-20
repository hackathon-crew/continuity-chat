import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AgentState } from '../../contract/types.ts'
import { publicUrl } from '../agent/public-web.ts'
import { availableTools, toolCatalog, verifyMcp } from '../agent/tools.ts'
import type { Config } from '../config.ts'
import { agentMemories, agentProfile, listAgentState, saveMemory } from '../db/agent.ts'
import { findAgentFile } from '../db/agent-files.ts'
import {
  deleteMcpServer,
  deleteMemory,
  listMcpServers,
  saveMcpServer,
  setReminderEnabled,
  updateMemory,
  updateProfile,
} from '../db/agent-settings.ts'
import { modelOf } from '../db/conversations.ts'
import type { PostgresStore } from '../db/store.ts'
import { HttpError, readJson, sendJson, uuidPattern } from '../http.ts'
import { newAttachment } from '../services/attachments.ts'
import type { AttachmentInput, AuthenticatedRequest, DialogueMessage, UserRow } from '../types.ts'

const agentRequestBytes = 16 * 1024 * 1024

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
    listMcpServers(store.db, user.id),
  ])
  return {
    ...state,
    memories,
    mcpServers: mcps,
    profile: {
      name: profile.name,
      persona: profile.persona,
      proactive: profile.proactive,
      timezone: profile.timezone,
    },
    tools: availableTools(settings, profile),
  }
}

export async function getAgent({ res, user, services }: AuthenticatedRequest) {
  return sendJson(res, 200, await agentState(services.store, user, services.settings))
}

export async function downloadAgentFile({
  res,
  user,
  services: { store },
  params,
}: AuthenticatedRequest) {
  const file = await findAgentFile(store.db, user.id, params.id)
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

export async function sendMessage({ req, res, user, services: { agent } }: AuthenticatedRequest) {
  const body = await readJson<SendInput>(req, agentRequestBytes)
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

export async function editProfile({ req, res, user, services }: AuthenticatedRequest) {
  const { store, settings } = services
  const profile = validate(profilePatch, await readJson(req))
  await agentProfile(store.db, user.id)
  await updateProfile(store.db, user.id, profile)
  return sendJson(res, 200, await agentState(store, user, settings))
}

export async function addMemory({ req, res, user, services: { store } }: AuthenticatedRequest) {
  const body = await readJson(req)
  const text = validate(textSchema.max(1800), body.text)
  await saveMemory(store.db, user.id, { id: randomUUID(), text }, '手动添加')
  return sendJson(res, 201, await agentMemories(store.db, user.id))
}

export async function editMemory({
  req,
  res,
  user,
  services: { store },
  params,
}: AuthenticatedRequest) {
  const text = validate(textSchema.max(1800), (await readJson(req)).text)
  await updateMemory(store.db, user.id, params.id, text)
  return sendJson(res, 200, await agentMemories(store.db, user.id))
}

export async function removeMemory({
  res,
  user,
  services: { store },
  params,
}: AuthenticatedRequest) {
  await deleteMemory(store.db, user.id, params.id)
  return sendJson(res, 200, await agentMemories(store.db, user.id))
}

export async function addMcp({ req, res, user, services: { store } }: AuthenticatedRequest) {
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

  await saveMcpServer(
    store.db,
    randomUUID(),
    user.id,
    url,
    token ? store.seal(user.id, 'mcp', token) : null
  )
  return sendJson(res, 201, { ok: true })
}

export async function removeMcp({ res, user, services: { store }, params }: AuthenticatedRequest) {
  await deleteMcpServer(store.db, user.id, params.id)
  return sendJson(res, 200, { ok: true })
}

export async function editReminder({
  req,
  res,
  user,
  services: { store },
  params,
}: AuthenticatedRequest) {
  const enabled = validate(z.boolean(), (await readJson(req)).enabled)
  const query = await setReminderEnabled(store.db, user.id, params.id, enabled)
  if (!query.rowCount) {
    throw new HttpError(404, '该提醒已经结束', 'not_found')
  }
  return sendJson(res, 200, { ok: true })
}
