import { getVisibleMessages } from './deepseek/branches'
import { describeReply } from './deepseek/describe'
import { stageArchive } from './deepseek/db'
import { importArchive } from './deepseek/history/importArchive'
import type { Session } from './deepseek/types'
import { encodeBlob, json } from '../../shared/api'
import type { ConversationSummary, Turn } from '../../../contract/types'

export const readDeepSeekArchive = (file: File) => stageArchive(() => importArchive(file))

function toTurns(session: Session, originals: Map<string, Blob>) {
  const turns: (Turn & { excludeFromContext?: boolean })[] = []
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      turns.push({
        id: message.id,
        question: message.content,
        answer: '',
        imported: true,
        files: message.files.map((file) => ({
          id: file.id,
          name: file.name,
          type: file.mimeType,
          available: originals.has(file.id),
        })),
      })
      continue
    }
    const turn = turns.at(-1)
    if (!turn) {
      continue
    }
    const notice = describeReply(message)
    turn.answer = message.blocks
      .flatMap((block) => (block.type === 'text' && !block.isTemplate ? [block.text] : []))
      .join('')
    turn.reasoning = message.blocks
      .flatMap((block) => (block.type === 'thinking' ? [block.thinking] : []))
      .join('')
    turn.steps = message.blocks.flatMap((block) => {
      if (block.type === 'server_tool_use') {
        const label = block.kind === 'read_link' ? '读取网页' : '联网搜索'
        return [{ id: block.id, label, status: 'completed' as const }]
      }
      return []
    })
    if (notice?.presentation === 'response') {
      turn.answer ||= notice.text
    } else if (notice) {
      turn.error = notice.text
    }
    turn.excludeFromContext = Boolean(notice || message.status === 'error')
  }
  return turns
}

export async function saveImportedConversation(
  source: 'deepseek' | 'legacy',
  archive: Session,
  originals: Map<string, Blob>,
  model: string
) {
  const ids = new Set(
    archive.messages.flatMap((message) =>
      message.role === 'user' ? message.files.map((file) => file.id) : []
    )
  )
  const files = []
  for (const id of ids) {
    const blob = originals.get(id)
    if (blob) {
      files.push({ id, type: blob.type, data: await encodeBlob(blob) })
    }
  }
  return json<ConversationSummary>('/api/conversations/import', 'POST', {
    source,
    archive,
    turns: toTurns(archive, originals),
    files,
    model,
  })
}
