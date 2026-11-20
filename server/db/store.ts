import { readFile } from 'node:fs/promises'
import pg, { type Pool, type PoolClient } from 'pg'
import type { Config } from '../config.ts'
import { decrypt, encrypt } from '../security.ts'

const schemaLock = 428718281

export class PostgresStore {
  declare readonly db: Pool
  declare readonly encryptionKey: string

  constructor(settings: Pick<Config, 'databaseUrl' | 'encryptionKey'>) {
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

  async transaction<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
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

  seal(userId: string, field: string, value: string) {
    return encrypt(value, this.encryptionKey, `${userId}:${field}`)
  }

  secret<Field extends string>(user: { id: string } & Record<Field, string>, field: Field) {
    return decrypt(user[field], this.encryptionKey, `${user.id}:${field}`)
  }
}
