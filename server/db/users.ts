import type { Db, TokenSet, UserRow } from '../types.ts'

export const loginLifetime = 10 * 60
export const sessionLifetime = 30 * 24 * 60 * 60

export async function findUser(db: Db, id: string, lock = false) {
  const { rows } = await db.query<UserRow>(
    `SELECT * FROM chat_users WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id]
  )
  return rows[0]
}

export async function addLogin(db: Db, stateHash: string, browserHash: string, verifier: string) {
  await db.query('DELETE FROM chat_login_attempts WHERE expires_at <= now()')
  await db.query(
    `
    INSERT INTO chat_login_attempts (state_hash, browser_hash, verifier, expires_at)
    VALUES ($1, $2, $3, now() + $4 * interval '1 second')
  `,
    [stateHash, browserHash, verifier, loginLifetime]
  )
}

export async function consumeLogin(db: Db, stateHash: string, browserHash: string) {
  const { rows } = await db.query<{ verifier: string }>(
    `
    DELETE FROM chat_login_attempts
    WHERE state_hash = $1 AND browser_hash = $2 AND expires_at > now()
    RETURNING verifier
  `,
    [stateHash, browserHash]
  )
  return rows[0]
}

export function upsertUser(db: Db, user: UserRow) {
  return db.query(
    `
    INSERT INTO chat_users (id, name, email, model_key, oauth_access, oauth_refresh, oauth_expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email,
      model_key = excluded.model_key, oauth_access = excluded.oauth_access,
      oauth_refresh = excluded.oauth_refresh, oauth_expires_at = excluded.oauth_expires_at
  `,
    [
      user.id,
      user.name,
      user.email,
      user.model_key,
      user.oauth_access,
      user.oauth_refresh,
      user.oauth_expires_at,
    ]
  )
}

export function deleteExpiredSessions(db: Db) {
  return db.query('DELETE FROM chat_sessions WHERE expires_at <= now()')
}

export function addSession(db: Db, sessionHash: string, userId: string) {
  return db.query(
    `
    INSERT INTO chat_sessions (token_hash, user_id, expires_at)
    VALUES ($1, $2, now() + $3 * interval '1 second')
  `,
    [sessionHash, userId, sessionLifetime]
  )
}

export async function findSession(db: Db, tokenHash: string) {
  const { rows } = await db.query<UserRow>(
    `
    SELECT u.* FROM chat_users u JOIN chat_sessions s ON s.user_id = u.id
    WHERE s.token_hash = $1 AND s.expires_at > now()
  `,
    [tokenHash]
  )
  return rows[0]
}

export function endSession(db: Db, tokenHash: string) {
  return db.query('DELETE FROM chat_sessions WHERE token_hash = $1', [tokenHash])
}

export function updateSealedTokens(db: Db, id: string, tokens: TokenSet) {
  return db.query(
    'UPDATE chat_users SET oauth_access = $2, oauth_refresh = $3, oauth_expires_at = $4 WHERE id = $1',
    [id, tokens.access, tokens.refresh, tokens.expiresAt]
  )
}
