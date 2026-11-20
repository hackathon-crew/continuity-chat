import type { Db, ItemPayload } from '../types.ts'

export function markLegacyMigration(db: Db, localId: string, userId: string) {
  return db.query(
    `
    INSERT INTO legacy_agent_migrations (local_account_id, user_id)
    VALUES ($1,$2) ON CONFLICT DO NOTHING
  `,
    [localId, userId]
  )
}

export function mergeLegacyProfile(
  db: Db,
  userId: string,
  name: string,
  persona: string,
  proactive: boolean
) {
  return db.query(
    `
    INSERT INTO agent_profiles (user_id, name, persona, proactive) VALUES ($1,$2,$3,$4)
    ON CONFLICT (user_id) DO UPDATE SET
      name = CASE WHEN agent_profiles.name = 'Uni' THEN excluded.name ELSE agent_profiles.name END,
      persona = CASE WHEN agent_profiles.persona = '' THEN excluded.persona ELSE agent_profiles.persona END
  `,
    [userId, name, persona, proactive]
  )
}

export function addLegacyMessage(
  db: Db,
  id: string,
  userId: string,
  payload: ItemPayload,
  at: Date
) {
  return db.query(
    'INSERT INTO agent_messages (id,user_id,payload,created_at) VALUES ($1,$2,$3,$4)',
    [id, userId, payload, at]
  )
}
