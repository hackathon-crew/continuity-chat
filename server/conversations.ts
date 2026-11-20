import type { ConversationSummary } from '../contract/types.ts'
import type { ConversationRow, Db, StoredTurn } from './types.ts'
import { randomUUID } from 'node:crypto'
import { HttpError } from './http.ts'

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const conversationSummary = (row: ConversationRow): ConversationSummary => ({
  id: row.id,
  title: row.title,
  model: row.model,
  pinned: row.pinned,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  imported: row.source
    ? {
        messages: row.origin?.messages?.length ?? 0,
        source: row.source,
        last: new Date(row.origin.updatedAt).toISOString(),
      }
    : undefined,
})

export async function listConversations(db: Db, userId: string) {
  const { rows } = await db.query<ConversationRow>(
    'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  )
  return rows.map(conversationSummary)
}

export async function findConversation(db: Db, userId: string, id: string, lock = false) {
  const { rows } = await db.query<ConversationRow>(
    `SELECT * FROM conversations WHERE user_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`,
    [userId, id]
  )
  if (!rows[0]) {
    throw new HttpError(404, '对话不存在', 'not_found')
  }
  return rows[0]
}

export async function getTurns(db: Db, id: string) {
  const { rows } = await db.query<{ payload: StoredTurn }>(
    'SELECT payload FROM chat_turns WHERE conversation_id = $1 ORDER BY position',
    [id]
  )
  return rows.map((row) => row.payload)
}

export async function createConversation(db: Db, userId: string, input: Record<string, unknown>) {
  const id = uuidPattern.test(input.id as string) ? input.id : randomUUID()
  const { rows } = await db.query<ConversationRow>(
    'INSERT INTO conversations (id, user_id, title, model) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, userId, titleOf(input.title), modelOf(input.model)]
  )
  return conversationSummary(rows[0])
}

export const titleOf = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 160) || '新对话' : '新对话'
export const modelOf = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 200) : ''

export async function editConversation(
  db: Db,
  userId: string,
  id: string,
  input: Record<string, unknown>
) {
  const { rows } = await db.query<ConversationRow>(
    `
    UPDATE conversations SET title = coalesce($3, title), model = coalesce($4, model),
      pinned = coalesce($5, pinned) WHERE id = $1 AND user_id = $2 RETURNING *
  `,
    [
      id,
      userId,
      typeof input.title === 'string' ? titleOf(input.title) : null,
      typeof input.model === 'string' ? modelOf(input.model) : null,
      typeof input.pinned === 'boolean' ? input.pinned : null,
    ]
  )
  if (!rows[0]) {
    throw new HttpError(404, '对话不存在', 'not_found')
  }
  return conversationSummary(rows[0])
}

export async function deleteConversation(db: Db, userId: string, id: string) {
  const result = await db.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ])
  if (!result.rowCount) {
    throw new HttpError(404, '对话不存在', 'not_found')
  }
}
