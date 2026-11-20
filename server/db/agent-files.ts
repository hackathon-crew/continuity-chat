import type { Db } from '../types.ts'

type AgentFile = { name: string; content: Buffer }

export function addAgentFile(db: Db, userId: string, file: AgentFile & { id: string }) {
  return db.query('INSERT INTO agent_files (id,user_id,name,content) VALUES ($1,$2,$3,$4)', [
    file.id,
    userId,
    file.name,
    file.content,
  ])
}

export async function findAgentFile(db: Db, userId: string, id: string) {
  const { rows } = await db.query<AgentFile>(
    'SELECT name,content FROM agent_files WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  return rows[0]
}
