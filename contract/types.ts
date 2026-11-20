export type ConversationToolStep = {
  id: string
  label: string
  status: 'running' | 'completed' | 'failed'
  interrupted?: boolean
  purpose?: string
  input?: unknown
  output?: unknown
  detail?: string
  resultItems?: readonly { id: string; title: string; excerpt?: string | null }[]
}

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
  artifacts?: { name: string; meta: string; fileId: string }[]
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
export type AgentProfile = { name: string; persona: string; proactive: boolean; timezone: string }

export type AgentItem = { id: string; createdAt?: string; taskId?: string } & (
  | { kind: 'time'; id: string; label: string }
  | { kind: 'agent'; id: string; text: string; streaming?: boolean }
  | { kind: 'user'; id: string; text: string; live?: boolean }
  | { kind: 'file'; id: string; name: string; meta: string; fileId: string }
  | { kind: 'activity'; id: string; steps: ConversationToolStep[] }
  | {
      kind: 'reminder'
      id: string
      title: string
      rule: 'once' | 'daily' | 'weekly'
      enabled: boolean
      reminderId: string
      at: string
      active?: boolean
    }
)

export type AgentJob = {
  id: string
  title: string
  state: 'running' | 'scheduled' | 'done' | 'waiting' | 'failed'
  source: 'agent' | 'chat' | 'timer' | 'legacy'
  dueAt?: string
  updatedAt: string
  enabled: boolean
  reminder: boolean
}
export type Memory = { id: string; text: string; from: string }

export type Tool = {
  id: string
  name: string
  detail: string
  builtIn: boolean
  available: boolean
  on: boolean
}
export type AgentState = {
  profile: AgentProfile
  items: AgentItem[]
  jobs: AgentJob[]
  memories: Memory[]
  tools: Tool[]
  mcpServers: { id: string; url: string }[]
}

export type ChatEvent =
  | { type: 'start'; turn: Turn; title: string }
  | { type: 'delta'; delta: string }
  | { type: 'step'; step: NonNullable<Turn['steps']>[number] }
  | { type: 'done'; turn: Turn }
