import type { AgentProfile } from '../../contract/types.ts'
import type { Db } from '../types.ts'

type ProfilePatch = Partial<AgentProfile & { disabledTools: string[] }>

export function updateProfile(db: Db, userId: string, profile: ProfilePatch) {
  return db.query(
    `
    UPDATE agent_profiles SET name = coalesce($2, name), persona = coalesce($3, persona),
      proactive = coalesce($4, proactive), timezone = coalesce($5, timezone),
      disabled_tools = coalesce($6, disabled_tools)
    WHERE user_id = $1
  `,
    [
      userId,
      profile.name,
      profile.persona,
      profile.proactive,
      profile.timezone,
      profile.disabledTools,
    ]
  )
}

export function updateMemory(db: Db, userId: string, id: string, text: string) {
  return db.query('UPDATE agent_memories SET body = $3 WHERE user_id = $1 AND id = $2', [
    userId,
    id,
    text,
  ])
}

export function deleteMemory(db: Db, userId: string, id: string) {
  return db.query('DELETE FROM agent_memories WHERE user_id = $1 AND id = $2', [userId, id])
}

export async function listMcpServers(db: Db, userId: string) {
  const { rows } = await db.query<{ id: string; url: string }>(
    'SELECT id,url FROM agent_mcp_servers WHERE user_id = $1 ORDER BY id',
    [userId]
  )
  return rows
}

export async function mcpCredentials(db: Db, userId: string) {
  const { rows } = await db.query<{ id: string; url: string; token: string | null }>(
    'SELECT id, url, token FROM agent_mcp_servers WHERE user_id = $1 ORDER BY id',
    [userId]
  )
  return rows
}

export function saveMcpServer(
  db: Db,
  id: string,
  userId: string,
  url: string,
  token: string | null
) {
  return db.query(
    `
    INSERT INTO agent_mcp_servers (id,user_id,url,token) VALUES ($1,$2,$3,$4)
    ON CONFLICT (user_id,url) DO UPDATE SET token = excluded.token
  `,
    [id, userId, url, token]
  )
}

export function deleteMcpServer(db: Db, userId: string, id: string) {
  return db.query('DELETE FROM agent_mcp_servers WHERE user_id = $1 AND id = $2', [userId, id])
}

export function setReminderEnabled(db: Db, userId: string, id: string, enabled: boolean) {
  return db.query(
    'UPDATE agent_tasks SET enabled = $3 WHERE id = $2 AND user_id = $1 AND reminder IS NOT NULL AND state = $4',
    [userId, id, enabled, 'scheduled']
  )
}
