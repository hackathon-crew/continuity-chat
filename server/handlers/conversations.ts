import type { ChatEvent } from '../../contract/types.ts'
import { findConversationFile } from '../db/conversation-files.ts'
import {
  conversationSummary,
  createConversation,
  deleteConversation,
  editConversation,
  findConversation,
  getTurns,
  listConversations,
  modelOf,
} from '../db/conversations.ts'
import { HttpError, readJson, sendJson, uuidPattern } from '../http.ts'
import { newAttachment } from '../services/attachments.ts'
import { beginTurn, completeTurn, turnDurationMs } from '../services/chat.ts'
import { importArchive, type ArchiveInput } from '../services/import.ts'
import type { AttachmentInput, AuthenticatedRequest, StoredTurn } from '../types.ts'

const archiveRequestBytes = 48 * 1024 * 1024
const turnRequestBytes = 16 * 1024 * 1024

export async function listChats({ res, services: { store }, user }: AuthenticatedRequest) {
  return sendJson(res, 200, await listConversations(store.db, user.id))
}

export async function createChat({ req, res, services: { store }, user }: AuthenticatedRequest) {
  return sendJson(res, 201, await createConversation(store.db, user.id, await readJson(req)))
}

export async function getChat({ res, services: { store }, user, params }: AuthenticatedRequest) {
  const row = await findConversation(store.db, user.id, params.id)
  return sendJson(res, 200, {
    ...conversationSummary(row),
    turns: await getTurns(store.db, params.id),
  })
}

export async function editChat({
  req,
  res,
  services: { store },
  user,
  params,
}: AuthenticatedRequest) {
  return sendJson(
    res,
    200,
    await editConversation(store.db, user.id, params.id, await readJson(req))
  )
}

export async function deleteChat({ res, services: { store }, user, params }: AuthenticatedRequest) {
  await deleteConversation(store.db, user.id, params.id)
  return sendJson(res, 200, { ok: true })
}

export async function importChat({ req, res, services: { store }, user }: AuthenticatedRequest) {
  const input = await readJson<ArchiveInput>(req, archiveRequestBytes)
  const outcome = await importArchive(store, user.id, input)
  sendJson(res, 201, outcome)
}

export async function downloadChatFile({
  res,
  services: { store },
  user,
  params,
}: AuthenticatedRequest) {
  const file = await findConversationFile(
    store.db,
    user.id,
    params.id,
    decodeURIComponent(params.fileId)
  )
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

type TurnInput = {
  id: string
  model: unknown
  question?: unknown
  replaceId?: string
  files?: AttachmentInput[]
  handoff?: unknown
  search?: unknown
}

export async function streamTurn({ req, res, params, user, services }: AuthenticatedRequest) {
  const input = await readJson<TurnInput>(req, turnRequestBytes)
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
  const turn: StoredTurn = {
    id: input.id,
    question,
    answer: '',
    streaming: true,
    startedAt: Date.now(),
    files: attachments.map(({ id, name, type, available }) => ({ id, name, type, available })),
  }
  const { id } = params
  const { context, title } = await beginTurn(
    services.store,
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
  function emit(event: ChatEvent) {
    if (!res.destroyed) {
      res.write(`${JSON.stringify(event)}\n`)
    }
  }
  emit({ type: 'start', title, turn })
  await completeTurn({
    services,
    user,
    id,
    turn,
    context,
    model,
    handoff: Boolean(input.handoff),
    search: input.search === true,
    signal,
    clientSignal: abort.signal,
    emit,
  })
  res.end()
}
