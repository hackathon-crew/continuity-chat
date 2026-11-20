import type { Db, DialogueMessage, TaskRow, TicketSource } from '../types.ts'

export function addTicket(
  db: Db,
  id: string,
  taskId: string,
  source: TicketSource,
  prompt: string
) {
  return db.query('INSERT INTO agent_tickets (id, task_id, source, prompt) VALUES ($1,$2,$3,$4)', [
    id,
    taskId,
    source,
    prompt,
  ])
}

export async function closeTicket(db: Db, id: string) {
  await db.query('UPDATE agent_tickets SET closed_at = now() WHERE id = $1', [id])
}

export async function ticketTask(db: Db, ticketId: string) {
  const { rows } = await db.query<TaskRow & { wake_prompt: string; wake_source: TicketSource }>(
    `
    SELECT task.*, ticket.prompt AS wake_prompt, ticket.source AS wake_source
    FROM agent_tickets ticket JOIN agent_tasks task ON task.id = ticket.task_id
    WHERE ticket.id = $1 AND ticket.closed_at IS NULL
  `,
    [ticketId]
  )
  return rows[0]
}

export function lockMessage(db: Db, messageId: string) {
  return db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [messageId])
}

export async function findMessageTask(db: Db, userId: string, messageId: string) {
  const { rows } = await db.query<{ task_id: string | null }>(
    'SELECT task_id FROM agent_messages WHERE user_id = $1 AND id = $2',
    [userId, messageId]
  )
  return rows[0]
}

export function appendTaskContext(db: Db, id: string, context: DialogueMessage[]) {
  return db.query('UPDATE agent_tasks SET context = context || $2::jsonb WHERE id = $1', [
    id,
    JSON.stringify(context),
  ])
}

export async function recentTaskMessages(db: Db, task: TaskRow, ticketId: string) {
  const { rows } = await db.query<{ payload: { kind: 'agent' | 'user'; text: string } }>(
    `
    SELECT payload FROM (
      SELECT payload, sequence, created_at FROM agent_messages
      WHERE user_id = $3 AND id <> $2 AND (task_id = $1 OR ($4 AND (
        task_id IS NULL OR task_id IN (SELECT id FROM agent_tasks WHERE user_id = $3 AND source = 'agent')
      )))
      AND payload->>'kind' IN ('user','agent') AND coalesce(payload->>'streaming', '') <> 'true'
      ORDER BY created_at DESC, sequence DESC LIMIT 50
    ) recent ORDER BY created_at, sequence
  `,
    [task.id, ticketId, task.user_id, task.source === 'agent']
  )
  return rows
}
