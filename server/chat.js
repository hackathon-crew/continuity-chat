import { readJson, HttpError } from './http.js'
import { findConversation, getTurns, modelOf, titleOf, uuidPattern } from './conversations.js'
import { newAttachment } from './archive.js'
import { completionDeltas } from './stream.js'

const turnDurationMs = 180_000
const turnRequestBytes = 16 * 1024 * 1024

export async function conversationMessages(db, id, turns) {
  const messages = []
  for (const turn of turns) {
    if (turn.excludeFromContext || turn.error) {
      continue
    }
    let content = turn.question
    const available = turn.files?.filter((file) => file.available) ?? []
    if (available.length) {
      const { rows } = await db.query(
        'SELECT id, media_type, content FROM conversation_files WHERE conversation_id = $1 AND id = ANY($2::text[])',
        [id, available.map((file) => file.id)]
      )
      const parts = [{ type: 'text', text: turn.question }]
      for (const file of rows) {
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

export function writeEvent(res, event) {
  if (!res.destroyed) {
    res.write(`${JSON.stringify(event)}\n`)
  }
}

export async function beginTurn(store, userId, id, turn, model, attachments, replaceId) {
  return store.transaction(async (db) => {
    const conversation = await findConversation(db, userId, id, true)
    const turns = await getTurns(db, id)
    const latest = turns.at(-1)
    if (latest?.streaming && Date.now() - latest.startedAt < turnDurationMs) {
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
      await db.query(
        'INSERT INTO conversation_files (conversation_id,id,media_type,content) VALUES ($1,$2,$3,$4)',
        [id, file.id, file.type, file.data]
      )
    }
    if (replaceId) {
      turn.question = latest.question
      turn.files = latest.files
      await db.query('UPDATE chat_turns SET payload = $3 WHERE conversation_id = $1 AND id = $2', [
        id,
        turn.id,
        turn,
      ])
    } else {
      await db.query('INSERT INTO chat_turns (conversation_id,id,payload) VALUES ($1,$2,$3)', [
        id,
        turn.id,
        turn,
      ])
    }
    const title =
      !turns.length && conversation.title === '新对话'
        ? titleOf(turn.question.slice(0, 24))
        : conversation.title
    await db.query(
      'UPDATE conversations SET model = $2, title = $3, updated_at = now() WHERE id = $1',
      [id, model, title]
    )
    return { title, context }
  })
}

export async function finishTurn(store, id, turn) {
  await store.db.query(
    'UPDATE chat_turns SET payload = $3 WHERE conversation_id = $1 AND id = $2',
    [id, turn.id, turn]
  )
}

export async function streamTurn(req, res, id, user, services) {
  const { store, unigate } = services
  const input = await readJson(req, turnRequestBytes)
  const question = typeof input.question === 'string' ? input.question.trim() : ''
  const model = modelOf(input.model)
  if (
    !uuidPattern.test(input.id) ||
    !model ||
    (!question && !input.replaceId) ||
    question.length > 8_000
  ) {
    throw new HttpError(400, '请选模型并输入消息', 'invalid_turn')
  }
  const attachments = Array.isArray(input.files) ? input.files.slice(0, 8).map(newAttachment) : []
  const turn = {
    id: input.id,
    question,
    answer: '',
    streaming: true,
    startedAt: Date.now(),
    files: attachments.map(({ id, name, type, available }) => ({ id, name, type, available })),
  }
  const { context, title } = await beginTurn(
    store,
    user.id,
    id,
    turn,
    model,
    attachments,
    input.replaceId
  )
  const abort = new AbortController()
  res.once('close', () => abort.abort())
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(turnDurationMs)])

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  })
  writeEvent(res, { type: 'start', title, turn })
  try {
    const messages = await conversationMessages(store.db, id, [...context, turn])
    const upstream = await unigate.model('/chat/completions', store.secret(user, 'model_key'), {
      method: 'POST',
      signal,
      body: JSON.stringify({ model, messages, stream: true }),
    })
    for await (const delta of completionDeltas(upstream)) {
      turn.answer += delta
      writeEvent(res, { type: 'delta', delta })
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      turn.error = error instanceof HttpError ? error.message : '回复中断。可以从这条消息重新生成。'
    }
  } finally {
    turn.streaming = false
    await finishTurn(store, id, turn)
    writeEvent(res, { type: 'done', turn })
    res.end()
  }
}
