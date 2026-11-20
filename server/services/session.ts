import type { PostgresStore } from '../db/store.ts'
import { addSession, deleteExpiredSessions, upsertUser } from '../db/users.ts'
import type { TokenSet, UniGateAccount } from '../types.ts'

export async function startSession(
  store: PostgresStore,
  me: UniGateAccount,
  key: string,
  tokens: TokenSet,
  sessionHash: string
) {
  const id = String(me.id)
  await store.transaction(async (db) => {
    await upsertUser(db, {
      id,
      name: me.username || me.email,
      email: me.email,
      model_key: store.seal(id, 'model_key', key),
      oauth_access: store.seal(id, 'oauth_access', tokens.access),
      oauth_refresh: store.seal(id, 'oauth_refresh', tokens.refresh),
      oauth_expires_at: tokens.expiresAt,
    })
    await deleteExpiredSessions(db)
    await addSession(db, sessionHash, id)
  })
}
