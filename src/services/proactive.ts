import { api, jsonBody } from './platform.js'
import { appendProactiveMessage } from './chat/store.js'

type OutboxMessage = {
  id: string
  sessionId: string | null
  sessionTitle: string
  content: string
  read: boolean
  createdAt: number
}

export function startProactiveDelivery() {
  let stopped = false
  let running = false
  const deliver = async () => {
    if (stopped || running || document.visibilityState === 'hidden') {
      return
    }
    running = true
    try {
      const result = await api<{ messages: OutboxMessage[] }>('/api/outbox')
      const unread = result.messages
        .filter((item) => !item.read)
        .sort((a, b) => a.createdAt - b.createdAt)
      const delivered: string[] = []
      for (const message of unread) {
        await appendProactiveMessage(message.sessionId, message.sessionTitle, message.content)
        delivered.push(message.id)
      }
      if (delivered.length) {
        await api('/api/outbox/ack', { method: 'POST', body: jsonBody({ ids: delivered }) })
      }
    } catch {
      // 下一次轮询重试，未成功落盘的消息不确认。
    } finally {
      running = false
    }
  }
  void deliver()
  const timer = setInterval(deliver, 15_000)
  document.addEventListener('visibilitychange', deliver)
  window.addEventListener('focus', deliver)
  return () => {
    stopped = true
    clearInterval(timer)
    document.removeEventListener('visibilitychange', deliver)
    window.removeEventListener('focus', deliver)
  }
}
