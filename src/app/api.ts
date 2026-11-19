import type { Model, Turn } from './data'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message)
  }
}

export async function request(path: string, method = 'GET', value?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {
    method,
    signal,
    headers: value === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new ApiError(
      response.status,
      data?.error?.message ?? '操作未完成，请检查连接',
      data?.error?.code
    )
  }
  return response
}

export async function json<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
  return (await request(path, method, value)).json()
}

export async function listModels(): Promise<Model[]> {
  const { data } = await json<{
    data: { id: string; display_name?: string; owned_by?: string; description?: string }[]
  }>('/v1/models')
  return data.map((model) => {
    const label = `${model.id} ${model.owned_by ?? ''}`.toLowerCase()
    const provider = label.includes('deepseek')
      ? 'deepseek'
      : /openai|gpt|codex/.test(label)
        ? 'openai'
        : 'generic'
    return { id: model.id, name: model.display_name || model.id, note: model.description, provider }
  })
}

export type ChatEvent =
  | { type: 'start'; turn: Turn; title: string }
  | { type: 'delta'; delta: string }
  | { type: 'step'; step: NonNullable<Turn['steps']>[number] }
  | { type: 'done'; turn: Turn }

export async function readChatEvents(response: Response, apply: (event: ChatEvent) => void) {
  if (!response.body) {
    throw new Error('未收到模型回复')
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let rest = ''
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const lines = (rest + value).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) {
          continue
        }
        const event: ChatEvent = JSON.parse(line)
        apply(event)
        finished ||= event.type === 'done'
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (!finished) {
    throw new Error('连接中断，重新打开这段对话可以恢复已保存的回复')
  }
}

export async function encodeBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(blob)
  })
}
