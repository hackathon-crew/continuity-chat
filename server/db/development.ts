import type { Db } from '../types.ts'

export const developmentDatabase = 'continuity_chat_fake'

export async function createDevelopmentDatabase(db: Db) {
  try {
    await db.query(`CREATE DATABASE ${developmentDatabase}`)
  } catch (error) {
    if ((error as { code?: string }).code !== '42P04') {
      throw error
    }
  }
}
