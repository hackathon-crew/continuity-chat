import type { ConversationToolStep } from '../everplain/app/conversation-view/types'

export type ModelProvider = 'deepseek' | 'openai' | 'generic'
export type Model = { id: string; name: string; provider: ModelProvider; note?: string }
export type ChatTask = {
  id: string
  title: string
  status: 'running' | 'done' | 'waiting' | 'failed'
}
export type ConversationFile = { id: string; name: string; type: string; available: boolean }

export type Turn = {
  id: string
  question: string
  answer: string
  reasoning?: string
  steps?: ConversationToolStep[]
  files?: ConversationFile[]
  task?: ChatTask
  imported?: boolean
  streaming?: boolean
  statusText?: string
  error?: string
}

export type ConversationSummary = {
  id: string
  title: string
  model: string
  pinned: boolean
  createdAt: string
  updatedAt: string
  imported?: { source: 'deepseek' | 'legacy'; messages: number; last: string }
}

export type Conversation = ConversationSummary & { turns: Turn[] }
export type User = { id: string; name: string; account: string }
export type Billing = {
  balance: number
  frozenBalance: number
  usage: { items: UsageRow[]; total: number; page: number; page_size: number }
  monthSpend: number
  rechargeUrl: string
}
export type UsageRow = {
  id: number
  created_at: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
  actual_cost: number
}
export type AgentProfile = { name: string; persona: string; proactive: boolean }
export const agent: AgentProfile = { name: 'Uni', persona: '', proactive: true }

export type AgentItem =
  | { kind: 'time'; id: string; label: string }
  | { kind: 'agent'; id: string; text: string; streaming?: boolean }
  | { kind: 'user'; id: string; text: string; live?: boolean }
  | { kind: 'file'; id: string; name: string; meta: string }
  | { kind: 'activity'; id: string; steps: ConversationToolStep[] }
  | { kind: 'reminder'; id: string; title: string; rule: string; enabled: boolean }

export type AgentJob = {
  id: string
  title: string
  detail: string
  state: 'running' | 'scheduled' | 'done' | 'waiting' | 'failed'
}
export type Memory = { id: string; text: string; from: string }

export const displayDate = (value: number | string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
