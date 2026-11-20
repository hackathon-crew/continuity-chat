import { randomUUID } from 'node:crypto'
import { conversationSummary, modelOf, titleOf } from './conversations.js'
import { HttpError, readJson, sendJson } from './http.js'

const archiveRequestBytes = 48 * 1024 * 1024
const inlineImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/tiff',
])

export async function importConversation(req, res, store, user) {
  const { source, archive, turns, files, model } = await readJson(req, archiveRequestBytes)
  if (
    !['deepseek', 'legacy'].includes(source) ||
    typeof archive?.id !== 'string' ||
    !archive.id ||
    archive.id.length > 512 ||
    !Array.isArray(archive.messages) ||
    !Array.isArray(turns) ||
    !Array.isArray(files) ||
    !Number.isFinite(archive.createdAt) ||
    !Number.isFinite(archive.updatedAt)
  ) {
    throw new HttpError(400, '导入的对话结构无效', 'invalid_archive')
  }

  const outcome = await store.transaction(async (db) => {
    const { rows } = await db.query(
      `
      INSERT INTO conversations (id, user_id, title, model, source, source_id, origin, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, source, source_id) DO NOTHING RETURNING *
    `,
      [
        randomUUID(),
        user.id,
        titleOf(archive.title),
        modelOf(model),
        source,
        archive.id,
        archive,
        new Date(archive.createdAt),
        new Date(archive.updatedAt),
      ]
    )
    const added = rows[0]
    if (!added) {
      const { rows: existing } = await db.query(
        'SELECT * FROM conversations WHERE user_id = $1 AND source = $2 AND source_id = $3',
        [user.id, source, archive.id]
      )
      return conversationSummary(existing[0])
    }
    for (const turn of turns) {
      if (
        typeof turn?.id !== 'string' ||
        typeof turn.question !== 'string' ||
        typeof turn.answer !== 'string'
      ) {
        throw new HttpError(400, '导入的消息结构无效', 'invalid_archive')
      }
      await db.query('INSERT INTO chat_turns (conversation_id, id, payload) VALUES ($1,$2,$3)', [
        added.id,
        turn.id,
        turn,
      ])
    }
    for (const file of files) {
      if (typeof file?.id !== 'string' || typeof file.data !== 'string') {
        throw new HttpError(400, '导入的附件结构无效', 'invalid_archive')
      }
      const mediaType = inlineImageTypes.has(file.type) ? file.type : 'application/octet-stream'
      await db.query(
        'INSERT INTO conversation_files (conversation_id, id, media_type, content) VALUES ($1,$2,$3,$4)',
        [added.id, file.id, mediaType, Buffer.from(file.data, 'base64')]
      )
    }
    return conversationSummary(added)
  })
  sendJson(res, 201, outcome)
}

export async function downloadConversationFile(res, db, userId, conversationId, fileId) {
  const { rows } = await db.query(
    `
    SELECT f.media_type, f.content FROM conversation_files f JOIN conversations c ON c.id = f.conversation_id
    WHERE c.user_id = $1 AND c.id = $2 AND f.id = $3
  `,
    [userId, conversationId, fileId]
  )
  const file = rows[0]
  if (!file) {
    throw new HttpError(404, '附件原件不可用', 'not_found')
  }
  res.writeHead(200, {
    'Content-Type': file.media_type,
    'Content-Length': file.content.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  res.end(file.content)
}

export function newAttachment(file) {
  const text = file?.type === 'text/plain' || file.type === 'text/markdown'
  const image = inlineImageTypes.has(file?.type)
  if (typeof file?.name !== 'string' || typeof file.data !== 'string' || !(text || image)) {
    throw new HttpError(400, '聊天附件支持文本和常见图片', 'invalid_attachment')
  }
  const data = Buffer.from(file.data, 'base64')
  if (data.length > 8 * 1024 * 1024) {
    throw new HttpError(413, '单个附件最多 8 MB', 'body_too_large')
  }
  return { id: randomUUID(), name: file.name.slice(0, 200), type: file.type, data, available: true }
}
