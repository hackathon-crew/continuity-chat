import type { ChatEvent, ConversationToolStep } from '../../contract/types.ts'
import { runModel } from '../agent/model.ts'
import { agentMemories, agentProfile } from '../db/agent.ts'
import { addConversationFile, conversationFiles } from '../db/conversation-files.ts'
import {
  findConversation,
  getTurns,
  insertTurn,
  titleOf,
  touchConversation,
  updateTurn,
} from '../db/conversations.ts'
import type { PostgresStore } from '../db/store.ts'
import { HttpError } from '../http.ts'
import type { Db, DialogueMessage, DialoguePart, Services, StoredTurn, UserRow } from '../types.ts'
import type { newAttachment } from './attachments.ts'

export const turnDurationMs = 180_000

export async function conversationMessages(
  db: Db,
  id: string,
  turns: StoredTurn[]
): Promise<DialogueMessage[]> {
  const messages: DialogueMessage[] = []
  for (const turn of turns) {
    if (turn.excludeFromContext || turn.error) {
      continue
    }
    let content: DialogueMessage['content'] = turn.question
    const available = turn.files?.filter((file) => file.available) ?? []
    if (available.length) {
      const files = await conversationFiles(
        db,
        id,
        available.map((file) => file.id)
      )
      const parts: DialoguePart[] = [{ type: 'text', text: turn.question }]
      for (const file of files) {
        if (file.media_type.startsWith('image/')) {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${file.media_type};base64,${file.content.toString('base64')}`,
            },
          })
        } else if (file.media_type.startsWith('text/')) {
          parts.push({ type: 'text', text: file.content.toString('utf8') })
        }
      }
      content = parts
    }
    messages.push({ role: 'user', content })
    if (turn.answer) {
      messages.push({ role: 'assistant', content: turn.answer })
    }
  }
  return messages
}

export async function beginTurn(
  store: PostgresStore,
  userId: string,
  id: string,
  turn: StoredTurn,
  model: string,
  attachments: ReturnType<typeof newAttachment>[],
  replaceId?: string
) {
  return store.transaction(async (db) => {
    const conversation = await findConversation(db, userId, id, true)
    const turns = await getTurns(db, id)
    const latest = turns.at(-1)
    if (latest?.streaming && Date.now() - (latest.startedAt as number) < turnDurationMs) {
      throw new HttpError(409, '这段对话还有一条回复正在生成', 'turn_running')
    }
    if (turns.some((item) => item.id === turn.id) && turn.id !== replaceId) {
      throw new HttpError(409, '这条消息已发送', 'turn_exists')
    }
    if (
      replaceId &&
      (turn.id !== replaceId || latest?.id !== replaceId || latest.task || latest.imported)
    ) {
      throw new HttpError(409, '只能重新生成最近一条回复', 'invalid_regeneration')
    }
    const context = replaceId ? turns.slice(0, -1) : turns
    for (const file of attachments) {
      await addConversationFile(db, id, file.id, file.type, file.data)
    }
    if (replaceId) {
      const replaced = latest as StoredTurn
      turn.question = replaced.question
      turn.files = replaced.files
      await updateTurn(db, id, turn)
    } else {
      await insertTurn(db, id, turn)
    }
    const title =
      !turns.length && conversation.title === '新对话'
        ? titleOf(turn.question.slice(0, 24))
        : conversation.title
    await touchConversation(db, id, model, title)
    return { title, context }
  })
}

type CompleteTurnInput = {
  services: Services
  user: UserRow
  id: string
  turn: StoredTurn
  context: StoredTurn[]
  model: string
  handoff: boolean
  search: boolean
  signal: AbortSignal
  clientSignal: AbortSignal
  emit: (event: ChatEvent) => void
}

export async function completeTurn({
  services,
  user,
  id,
  turn,
  context,
  model,
  handoff,
  search,
  signal,
  clientSignal,
  emit,
}: CompleteTurnInput) {
  const { store, settings, agent } = services
  if (handoff) {
    try {
      const history = await conversationMessages(store.db, id, context)
      const [current] = await conversationMessages(store.db, id, [turn])
      const incoming = Array.isArray(current?.content) ? [...history, current] : history
      const receipt = await agent.handoff(user, id, turn, incoming, model)
      emit({ type: 'done', turn: receipt })
    } catch (error) {
      turn.streaming = false
      turn.error = error instanceof HttpError ? error.message : '任务还没有交给 Uni，可以重新发送。'
      await updateTurn(store.db, id, turn)
      emit({ type: 'done', turn })
    }
    return
  }
  try {
    const [messages, profile, memories] = await Promise.all([
      conversationMessages(store.db, id, [...context, turn]),
      agentProfile(store.db, user.id),
      agentMemories(store.db, user.id),
    ])
    const steps = new Map<string, ConversationToolStep>()
    const { effects } = await runModel({
      store,
      settings,
      user,
      profile,
      memories,
      messages,
      model,
      search,
      signal,
      onDelta: (delta) => {
        turn.answer += delta
        emit({ type: 'delta', delta })
      },
      onStep: (step) => {
        steps.set(step.id, step)
        turn.steps = [...steps.values()]
        emit({ type: 'step', step })
      },
    })
    turn.streaming = false
    await store.transaction(async (db) => {
      turn.artifacts = await agent.publishEffects(db, user, model, effects)
      await updateTurn(db, id, turn)
    })
  } catch (error) {
    if (!clientSignal.aborted) {
      turn.error =
        (error as { statusCode?: number }).statusCode === 402
          ? 'UniGate 余额不足，请充值后重新生成。'
          : error instanceof HttpError
            ? error.message
            : '回复中断。可以从这条消息重新生成。'
    }
    turn.streaming = false
    await updateTurn(store.db, id, turn)
  }
  emit({ type: 'done', turn })
}
