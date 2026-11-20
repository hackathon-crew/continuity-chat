import { addLegacyMessage, markLegacyMigration, mergeLegacyProfile } from '../server/db/legacy.ts'
import { findUser } from '../server/db/users.ts'
import type { ItemPayload } from '../server/types.ts'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createTask, saveMemory } from '../server/db/agent.ts'
import { config } from '../server/config.ts'
import { PostgresStore } from '../server/db/store.ts'

type LegacyWorkspace = {
  users: { id: string }[]
  profiles?: Record<
    string,
    {
      soul?: { personality?: string; speakingStyle?: string }
      proactive?: { enabled?: boolean }
      memories?: { enabled?: boolean; content?: unknown }[]
    }
  >
  agentProfiles?: Record<string, { name?: string; mission?: string; instructions?: string }>
  agentMessages?: { userId: string; content: unknown; role: string; createdAt: number }[]
  tasks?: { userId: string; title: unknown; prompt: unknown; enabled?: boolean }[]
}

const [sourcePath, mappingPath, model] = process.argv.slice(2)
if (!sourcePath || !mappingPath || !model || !config.databaseUrl) {
  throw new Error('Usage: pnpm import:legacy <store.json> <account-map.json> <UniGate model ID>')
}

const [legacy, mapping] = (await Promise.all(
  [sourcePath, mappingPath].map(async (file) => JSON.parse(await readFile(file, 'utf8')))
)) as [LegacyWorkspace, Record<string, unknown>]
if (
  !Array.isArray(legacy.users) ||
  !mapping ||
  typeof mapping !== 'object' ||
  Array.isArray(mapping)
) {
  throw new Error('The source and account map are invalid')
}

const store = new PostgresStore(config)
try {
  await store.init()
  for (const [localId, subject] of Object.entries(mapping)) {
    const userId = String(subject)
    if (
      !/^\d+$/.test(userId) ||
      !legacy.users.some((user) => user.id === localId) ||
      !(await findUser(store.db, userId))
    ) {
      throw new Error('Each mapping must link an old account to a signed-in UniGate user')
    }

    const migrated = await store.transaction(async (db) => {
      const marker = await markLegacyMigration(db, localId, userId)
      if (!marker.rowCount) {
        return false
      }

      const old = legacy.profiles?.[localId]
      const profile = legacy.agentProfiles?.[localId]
      const customName =
        profile?.name && profile.name !== 'Personal Agent' ? profile.name.slice(0, 28) : 'Uni'
      const persona = [
        profile?.mission,
        profile?.instructions,
        old?.soul?.personality,
        old?.soul?.speakingStyle,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 3000)
      await mergeLegacyProfile(db, userId, customName, persona, old?.proactive?.enabled !== false)

      for (const row of old?.memories ?? []) {
        if (row.enabled !== false && typeof row.content === 'string' && row.content.trim()) {
          await saveMemory(db, userId, { id: randomUUID(), text: row.content }, '旧版导入')
        }
      }
      for (const row of legacy.agentMessages ?? []) {
        if (
          row.userId === localId &&
          typeof row.content === 'string' &&
          ['user', 'assistant'].includes(row.role)
        ) {
          const payload: ItemPayload = {
            kind: row.role === 'user' ? 'user' : 'agent',
            text: row.content,
          }
          const at = Number.isFinite(row.createdAt) ? new Date(row.createdAt) : new Date()
          await addLegacyMessage(db, randomUUID(), userId, payload, at)
        }
      }
      for (const row of legacy.tasks ?? []) {
        if (
          row.userId === localId &&
          typeof row.title === 'string' &&
          typeof row.prompt === 'string'
        ) {
          await createTask(db, userId, {
            title: row.title,
            prompt: row.prompt,
            model,
            source: 'legacy',
            state: row.enabled ? 'waiting' : 'done',
          })
        }
      }
      return true
    })
    process.stdout.write(
      migrated ? 'Migrated one legacy workspace.\n' : 'Legacy workspace already migrated.\n'
    )
  }
} finally {
  await store.db.end()
}
