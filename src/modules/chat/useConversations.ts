import { useRef, useState } from 'react'
import { encodeBlob, json, readChatEvents, request } from '../../shared/api'
import { type Conversation, type ConversationSummary, type Turn } from '../../../contract/types'

export type SendOptions = { search: boolean; handoff: boolean; files?: File[]; replaceId?: string }

const endpoint = (id: string) => `/api/conversations/${id}`

export function useConversations(report: (message: string) => void, refreshBilling: () => void) {
  const [chats, setChats] = useState<Conversation[]>([])
  const active = useRef(new Map<string, AbortController>())
  const drafts = useRef(new Set<string>())

  function storeChat(summary: ConversationSummary, turns?: Turn[]) {
    setChats((list) => {
      const prior = list.find((chat) => chat.id === summary.id)
      const updated = { ...summary, turns: turns ?? prior?.turns ?? [] }
      return [updated, ...list.filter((chat) => chat.id !== summary.id)]
    })
  }

  async function loadList() {
    const list = await json<ConversationSummary[]>('/api/conversations')
    setChats(list.map((summary) => ({ ...summary, turns: [] })))
  }

  async function open(id: string) {
    if (drafts.current.has(id) || active.current.has(id)) {
      return
    }
    const chat = await json<Conversation>(endpoint(id))
    storeChat(chat, chat.turns)
  }

  function startDraft(model: string) {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    drafts.current.add(id)
    storeChat({ id, title: '新对话', model, pinned: false, createdAt: now, updatedAt: now })
    return id
  }

  function reset() {
    for (const controller of active.current.values()) {
      controller.abort()
    }
    drafts.current.clear()
    setChats([])
  }

  async function edit(
    chat: Conversation,
    patch: Partial<Pick<Conversation, 'model' | 'title' | 'pinned'>>
  ) {
    if (drafts.current.has(chat.id)) {
      storeChat({ ...chat, ...patch })
      return
    }
    const saved = await json<ConversationSummary>(endpoint(chat.id), 'PATCH', patch)
    storeChat(saved)
  }

  async function remove(id: string) {
    if (!drafts.current.delete(id)) {
      await json(endpoint(id), 'DELETE')
    }
    active.current.get(id)?.abort()
    setChats((list) => list.filter((chat) => chat.id !== id))
  }

  function patchChat(id: string, transform: (chat: Conversation) => Conversation) {
    setChats((list) => list.map((chat) => (chat.id === id ? transform(chat) : chat)))
  }

  function patchTurn(chat: string, id: string, transform: (turn: Turn) => Turn) {
    patchChat(chat, (old) => ({
      ...old,
      turns: old.turns.map((item) => (item.id === id ? transform(item) : item)),
    }))
  }

  async function send(chat: Conversation, text: string, model: string, options: SendOptions) {
    if (active.current.has(chat.id)) {
      return
    }
    const controller = new AbortController()
    const id = options.replaceId ?? crypto.randomUUID()
    const previous = chat.turns.find((item) => item.id === id)
    const turn: Turn = { id, question: text, answer: '', streaming: true, statusText: '正在思考' }
    active.current.set(chat.id, controller)
    patchChat(chat.id, (old) => ({
      ...old,
      turns: [...old.turns.filter((item) => item.id !== id), turn],
    }))
    try {
      if (drafts.current.has(chat.id)) {
        const saved = await json<ConversationSummary>('/api/conversations', 'POST', {
          id: chat.id,
          model,
        })
        drafts.current.delete(chat.id)
        storeChat(saved)
      }
      const files = await Promise.all(
        (options.files ?? []).map(async (file) => ({
          name: file.name,
          type: file.type || (file.name.endsWith('.md') ? 'text/markdown' : 'text/plain'),
          data: await encodeBlob(file),
        }))
      )
      const response = await request(
        `${endpoint(chat.id)}/turns`,
        'POST',
        {
          id,
          model,
          question: text,
          search: options.search,
          handoff: options.handoff,
          replaceId: options.replaceId,
          files,
        },
        controller.signal
      )
      await readChatEvents(response, (event) => {
        switch (event.type) {
          case 'start':
            patchChat(chat.id, (item) => ({
              ...item,
              title: event.title,
              updatedAt: new Date().toISOString(),
            }))
            patchTurn(chat.id, id, () => event.turn)
            break
          case 'delta':
            patchTurn(chat.id, id, (item) => ({ ...item, answer: item.answer + event.delta }))
            break
          case 'step':
            patchTurn(chat.id, id, (item) => ({
              ...item,
              steps: [
                ...(item.steps ?? []).filter((step) => step.id !== event.step.id),
                event.step,
              ],
            }))
            break
          case 'done':
            patchTurn(chat.id, id, () => event.turn)
            break
        }
      })
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '发送失败'
        patchTurn(chat.id, id, (item) => previous ?? { ...item, error: message, streaming: false })
        report(message)
      } else {
        patchTurn(chat.id, id, (item) => ({ ...item, streaming: false }))
      }
    } finally {
      active.current.delete(chat.id)
      refreshBilling()
    }
  }

  function stop(id: string) {
    active.current.get(id)?.abort()
  }

  return {
    chats,
    isDraft: (id: string) => drafts.current.has(id),
    open,
    loadList,
    startDraft,
    reset,
    edit,
    remove,
    send,
    stop,
    storeChat,
    patchTurn,
  }
}
