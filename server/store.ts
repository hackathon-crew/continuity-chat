import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { decrypt, encrypt } from './security.ts'

const schemaLock = 428718281
export const loginLifetime = 10 * 60
export const sessionLifetime = 30 * 24 * 60 * 60

export class PostgresStore {
  constructor(settings) {
    this.db = new pg.Pool({ connectionString: settings.databaseUrl })
    this.encryptionKey = settings.encryptionKey
  }

  async init() {
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
    await this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [schemaLock])
      await db.query(schema)
    })
  }

  async transaction(run) {
    const db = await this.db.connect()
    try {
      await db.query('BEGIN')
      const result = await run(db)
      await db.query('COMMIT')
      return result
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally {
      db.release()
    }
  }

  seal(userId, field, value) {
    return encrypt(value, this.encryptionKey, `${userId}:${field}`)
  }

  secret(user, field) {
    return decrypt(user[field], this.encryptionKey, `${user.id}:${field}`)
  }

  async user(id, db = this.db, lock = false) {
    const { rows } = await db.query(
      `SELECT * FROM chat_users WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id]
    )
    return rows[0]
  }

  async addLogin(stateHash, browserHash, verifier) {
    await this.db.query('DELETE FROM chat_login_attempts WHERE expires_at <= now()')
    await this.db.query(
      `
      INSERT INTO chat_login_attempts (state_hash, browser_hash, verifier, expires_at)
      VALUES ($1, $2, $3, now() + $4 * interval '1 second')
    `,
      [stateHash, browserHash, verifier, loginLifetime]
    )
  }

  async consumeLogin(stateHash, browserHash) {
    const { rows } = await this.db.query(
      `
      DELETE FROM chat_login_attempts
      WHERE state_hash = $1 AND browser_hash = $2 AND expires_at > now()
      RETURNING verifier
    `,
      [stateHash, browserHash]
    )
    return rows[0]
  }

  async startSession(me, key, tokens, sessionHash) {
    const id = String(me.id)
    await this.transaction(async (db) => {
      await db.query(
        `
        INSERT INTO chat_users (id, name, email, model_key, oauth_access, oauth_refresh, oauth_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email,
          model_key = excluded.model_key, oauth_access = excluded.oauth_access,
          oauth_refresh = excluded.oauth_refresh, oauth_expires_at = excluded.oauth_expires_at
      `,
        [
          id,
          me.username || me.email,
          me.email,
          this.seal(id, 'model_key', key),
          this.seal(id, 'oauth_access', tokens.access),
          this.seal(id, 'oauth_refresh', tokens.refresh),
          tokens.expiresAt,
        ]
      )
      await db.query('DELETE FROM chat_sessions WHERE expires_at <= now()')
      await db.query(
        `
        INSERT INTO chat_sessions (token_hash, user_id, expires_at)
        VALUES ($1, $2, now() + $3 * interval '1 second')
      `,
        [sessionHash, id, sessionLifetime]
      )
    })
  }

  async session(tokenHash) {
    const { rows } = await this.db.query(
      `
      SELECT u.* FROM chat_users u JOIN chat_sessions s ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()
    `,
      [tokenHash]
    )
    return rows[0]
  }

  endSession(tokenHash) {
    return this.db.query('DELETE FROM chat_sessions WHERE token_hash = $1', [tokenHash])
  }

  updateTokens(db, id, tokens) {
    return db.query(
      'UPDATE chat_users SET oauth_access = $2, oauth_refresh = $3, oauth_expires_at = $4 WHERE id = $1',
      [
        id,
        this.seal(id, 'oauth_access', tokens.access),
        this.seal(id, 'oauth_refresh', tokens.refresh),
        tokens.expiresAt,
      ]
    )
  }
}
