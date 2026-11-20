import { addConversationFile } from '../db/conversation-files.ts'
import {
  conversationSummary,
  findImportedConversation,
  insertImportedConversation,
  insertTurn,
} from '../db/conversations.ts'
import type { PostgresStore } from '../db/store.ts'
import { HttpError } from '../http.ts'
import type { ArchiveOrigin, StoredTurn } from '../types.ts'
import { inlineImageTypes } from './attachments.ts'

export type ArchiveInput = {
  source: 'deepseek' | 'legacy'
  archive: ArchiveOrigin
  turns: StoredTurn[]
  files: { id: string; type: string; data: string }[]
  model: unknown
}

export async function importArchive(store: PostgresStore, userId: string, input: ArchiveInput) {
  const { source, archive, turns, files, model } = input
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

  return store.transaction(async (db) => {
    const added = await insertImportedConversation(db, userId, source, archive, model)
    if (!added) {
      return conversationSummary(await findImportedConversation(db, userId, source, archive.id))
    }
    for (const turn of turns) {
      if (
        typeof turn?.id !== 'string' ||
        typeof turn.question !== 'string' ||
        typeof turn.answer !== 'string'
      ) {
        throw new HttpError(400, '导入的消息结构无效', 'invalid_archive')
      }
      await insertTurn(db, added.id, turn)
    }
    for (const file of files) {
      if (typeof file?.id !== 'string' || typeof file.data !== 'string') {
        throw new HttpError(400, '导入的附件结构无效', 'invalid_archive')
      }
      const mediaType = inlineImageTypes.has(file.type) ? file.type : 'application/octet-stream'
      await addConversationFile(db, added.id, file.id, mediaType, Buffer.from(file.data, 'base64'))
    }
    return conversationSummary(added)
  })
}
