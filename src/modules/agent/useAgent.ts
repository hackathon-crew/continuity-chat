import { useCallback, useEffect, useState } from 'react'
import { encodeBlob, json } from '../../shared/api'
import type {
  AgentItem,
  AgentJob,
  AgentProfile,
  AgentState,
  Tool,
} from '../../../contract/types'

const agent: AgentProfile = {
  name: 'Uni',
  persona: '',
  proactive: true,
  timezone: 'Asia/Shanghai',
}

const initial: AgentState = {
  profile: { ...agent, timezone: 'Asia/Shanghai' },
  items: [],
  jobs: [],
  memories: [],
  tools: [],
  mcpServers: [],
}
const pollMs = 2000
const celebrationMs = 2200

export function useUni(
  userId: string | undefined,
  report: (message: string) => void,
  onResult: () => void
) {
  const [state, setState] = useState(initial)
  const [optimistic, setOptimistic] = useState<AgentItem>()
  const [selected, setSelected] = useState<AgentJob>()
  const [celebrating, setCelebrating] = useState(false)

  const load = useCallback(async () => {
    const payload = await json<AgentState>('/api/agent')
    setState(payload)
    setOptimistic((local) =>
      payload.items.some((item) => item.id === local?.id) ? undefined : local
    )
    return payload
  }, [])

  useEffect(() => {
    if (!userId) {
      setState(initial)
      setOptimistic(undefined)
      setSelected(undefined)
      return
    }
    let active = true
    let timer: number
    let previousResult: string | undefined
    let loaded = false
    async function check() {
      try {
        const payload = await json<AgentState>('/api/agent')
        if (!active) {
          return
        }
        const result = payload.items.findLast(
          (item) => item.kind === 'agent' && !item.streaming
        )?.id
        if (result && loaded && result !== previousResult) {
          setCelebrating(true)
          onResult()
        }
        loaded = true
        previousResult = result
        setState(payload)
        setOptimistic((local) =>
          payload.items.some((item) => item.id === local?.id) ? undefined : local
        )
      } catch (error) {
        if (
          active &&
          !(error && typeof error === 'object' && 'status' in error && error.status === 401)
        ) {
          report(error instanceof Error ? error.message : '无法读取 Uni 的任务')
        }
      } finally {
        if (active) {
          timer = window.setTimeout(() => void check(), pollMs)
        }
      }
    }
    void check()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [userId, onResult, report])

  useEffect(() => {
    if (celebrating) {
      const timer = window.setTimeout(() => setCelebrating(false), celebrationMs)
      return () => window.clearTimeout(timer)
    }
  }, [celebrating])

  async function send(text: string, model: string, files: File[] = [], task = selected) {
    const messageId = crypto.randomUUID()
    setOptimistic({ id: messageId, kind: 'user', text, live: true })
    try {
      const attached = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || (file.name.endsWith('.md') ? 'text/markdown' : 'text/plain'),
          data: await encodeBlob(file),
        }))
      )
      await json('/api/agent/messages', 'POST', {
        text,
        model,
        messageId,
        taskId: task?.id,
        files: attached,
      })
      setSelected(undefined)
      await load()
    } catch (error) {
      setOptimistic(undefined)
      report(error instanceof Error ? error.message : '消息未发送')
    }
  }

  async function patchProfile(patch: Partial<AgentProfile> & { disabledTools?: string[] }) {
    setState(await json<AgentState>('/api/agent/profile', 'PATCH', patch))
  }

  async function changeTool(tool: Tool) {
    const disabledTools = state.tools
      .filter((item) => item.available && (item.id === tool.id ? item.on : !item.on))
      .map((item) => item.id)
    await patchProfile({ disabledTools })
  }

  async function changeMemory(id: string | undefined, text?: string) {
    const path = id ? `/api/agent/memories/${id}` : '/api/agent/memories'
    await json(
      path,
      text === undefined ? 'DELETE' : id ? 'PATCH' : 'POST',
      text === undefined ? undefined : { text }
    )
    await load()
  }

  async function connectMcp(url: string, token?: string) {
    await json('/api/agent/mcp', 'POST', { url, token })
    await load()
  }

  async function removeMcp(id: string) {
    await json(`/api/agent/mcp/${id}`, 'DELETE')
    await load()
  }

  async function toggleReminder(id: string, enabled: boolean) {
    await json(`/api/agent/reminders/${id}`, 'PATCH', { enabled })
    await load()
  }

  const items =
    optimistic && !state.items.some((item) => item.id === optimistic.id)
      ? [...state.items, optimistic]
      : state.items
  const pending = Boolean(optimistic) || state.jobs.some((job) => job.state === 'running')
  const streaming = items.some((item) => item.kind === 'agent' && item.streaming)
  const mood = streaming ? 'talk' : pending ? 'think' : celebrating ? 'happy' : 'idle'

  return {
    ...state,
    items,
    pending,
    mood,
    selected,
    setSelected,
    send,
    load,
    patchProfile,
    changeTool,
    changeMemory,
    connectMcp,
    removeMcp,
    toggleReminder,
  } as const
}
