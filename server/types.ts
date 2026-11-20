import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import type { AgentItem, AgentJob, AgentProfile, Turn } from '../contract/types.ts'
import type { startAgent } from './agent/queue.ts'
import type { Config } from './config.ts'
import type { PostgresStore } from './db/store.ts'
import type { UniGateClient } from './services/unigate.ts'

export type Db = Pick<Pool, 'query'>

export type CoreServices = {
  settings: Config & { databaseUrl: string }
  store: PostgresStore
  unigate: UniGateClient
}

export type Services = CoreServices & { agent: Awaited<ReturnType<typeof startAgent>> }

export type UserRow = {
  id: string
  name: string
  email: string
  model_key: string
  oauth_access: string
  oauth_refresh: string
  oauth_expires_at: Date
}

export type TokenSet = { access: string; refresh: string; expiresAt: Date }
export type UniGateAccount = {
  id: string | number
  username?: string
  email: string
  balance: number
  frozen_balance: number
}

export type StoredTurn = Turn & { startedAt?: number; excludeFromContext?: boolean }

export type ArchiveOrigin = {
  id: string
  title: unknown
  messages: unknown[]
  createdAt: number
  updatedAt: number
}

export type ConversationRow = {
  id: string
  title: string
  model: string
  pinned: boolean
  created_at: Date
  updated_at: Date
} & ({ source: null; origin: null } | { source: 'deepseek' | 'legacy'; origin: ArchiveOrigin })

export type AttachmentInput = { name?: unknown; data?: unknown; type: string }
export type DialoguePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type DialogueMessage = { role: 'user' | 'assistant'; content: string | DialoguePart[] }

export type ProfileRow = AgentProfile & { disabled_tools: string[] }
export type ReminderSpec = {
  repeat: Extract<AgentItem, { kind: 'reminder' }>['rule']
  targetAt: string
}
export type TaskState = AgentJob['state']
export type TaskSource = AgentJob['source']
export type TicketSource = Exclude<TaskSource, 'legacy'>

export type TaskRow = {
  id: string
  user_id: string
  title: string
  prompt: string
  model: string
  context: DialogueMessage[]
  source: TaskSource
  state: TaskState
  conversation_id: string | null
  turn_id: string | null
  due_at: Date | null
  updated_at: Date
  enabled: boolean
  reminder: ReminderSpec | null
}

type WithoutItemMetadata<Item> = Item extends AgentItem
  ? Omit<Item, 'id' | 'createdAt' | 'taskId' | 'enabled' | 'active' | 'live'>
  : never

export type ItemPayload = WithoutItemMetadata<AgentItem>

export type RouteRequest = {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  services: Services
  params: Record<string, string>
}

export type AuthenticatedRequest = RouteRequest & { user: UserRow }
