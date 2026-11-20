import type { Db } from '../types.ts'

type FileContent = { media_type: string; content: Buffer }

export async function addConversationFile(
  db: Db,
  conversationId: string,
  id: string,
  mediaType: string,
  content: Buffer
) {
  await db.query(
    'INSERT INTO conversation_files (conversation_id, id, media_type, content) VALUES ($1,$2,$3,$4)',
    [conversationId, id, mediaType, content]
  )
}

export async function conversationFiles(db: Db, conversationId: string, ids: string[]) {
  const { rows } = await db.query<FileContent & { id: string }>(
    'SELECT id, media_type, content FROM conversation_files WHERE conversation_id = $1 AND id = ANY($2::text[])',
    [conversationId, ids]
  )
  return rows
}

export async function findConversationFile(
  db: Db,
  userId: string,
  conversationId: string,
  fileId: string
) {
  const { rows } = await db.query<FileContent>(
    `
    SELECT f.media_type, f.content FROM conversation_files f JOIN conversations c ON c.id = f.conversation_id
    WHERE c.user_id = $1 AND c.id = $2 AND f.id = $3
  `,
    [userId, conversationId, fileId]
  )
  return rows[0]
}
