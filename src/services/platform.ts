export type PlatformUser = {
  id: string
  email: string
  name: string
  createdAt: number
  keyMode: 'platform' | 'byok'
  hasStoredKey: boolean
}

export type Soul = {
  companionName: string
  userName: string
  relationship: string
  personality: string
  speakingStyle: string
  boundaries: string
  customInstructions: string
}

export type Memory = {
  id: string
  content: string
  category: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type CompanionProfile = {
  soul: Soul
  memories: Memory[]
  proactive: { enabled: boolean; quietStart: string; quietEnd: string }
}

export type Tool = {
  id: string
  type: 'current_time' | 'calculator' | 'read_url' | 'webhook'
  name: string
  description: string
  enabled: boolean
  config: { url?: string }
}

export type AgentProfile = {
  name: string
  mission: string
  instructions: string
  autonomy: 'confirm' | 'auto'
}

export type AgentMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  trigger: string
  createdAt: number
  trace?: { name: string; input: unknown; output: string }[]
}

export type ScheduleTask = {
  id: string
  title: string
  prompt: string
  kind: 'once' | 'interval' | 'daily'
  target: 'companion' | 'agent'
  sessionId: string | null
  sessionTitle: string
  enabled: boolean
  timeZone: string
  runAt?: string
  intervalMinutes?: number
  timeOfDay?: string
  nextRunAt: number
  lastRunAt?: number
  lastError?: string | null
  lastResult?: string
}

export type Plan = {
  id: 'free' | 'plus' | 'pro'
  name: string
  price: number
  currency: string
  interval: string
  description: string
  features: string[]
}

export type BillingData = {
  plans: Plan[]
  subscription: {
    planId: string
    status: string
    cancelAtPeriodEnd: boolean
    provider: string
    currentPeriodEnd?: number
  }
  invoices: {
    id: string
    planId: string
    amount: number
    currency: string
    status: string
    description: string
    createdAt: number
  }[]
  stripeConfigured: boolean
  demoMode: boolean
}

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new PlatformError(
      body?.error?.message ?? `请求失败（${response.status}）`,
      response.status,
      body?.error?.code ?? 'request_error'
    )
  }
  return body as T
}

export const getCompanionPrompt = () =>
  api<{ prompt: string; search: boolean; readUrl: boolean }>('/api/companion/prompt')

export const jsonBody = (value: unknown) => JSON.stringify(value)
export const formatMoney = (amount: number, currency = 'cny') =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount / 100)
