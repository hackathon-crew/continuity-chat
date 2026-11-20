import type { AgentItem, AgentState, Memory } from '../../contract/types.ts'
import type {
  Db,
  DialogueMessage,
  ItemPayload,
  ProfileRow,
  ReminderSpec,
  TaskRow,
  TaskSource,
  TaskState,
} from '../types.ts'
import { randomUUID } from 'node:crypto'
import { HttpError } from '../http.ts'

export async function agentProfile(db: Db, userId: string) {
  await db.query('INSERT INTO agent_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [
    userId,
  ])
  const { rows } = await db.query<ProfileRow>('SELECT * FROM agent_profiles WHERE user_id = $1', [
    userId,
  ])
  return rows[0]
}

export async function agentMemories(db: Db, userId: string) {
  const { rows } = await db.query<Memory>(
    'SELECT id, body AS text, source AS "from" FROM agent_memories WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  )
  return rows
}

export async function appendItem(
  db: Db,
  userId: string,
  taskId: string | null,
  payload: ItemPayload,
  id: string = randomUUID()
) {
  const result = await db.query(
    `
    INSERT INTO agent_messages (id, user_id, task_id, payload) VALUES ($1,$2,$3,$4)
    ON CONFLICT (id) DO UPDATE SET payload = excluded.payload
    WHERE agent_messages.user_id = excluded.user_id
  `,
    [id, userId, taskId, payload]
  )
  if (!result.rowCount) {
    throw new HttpError(409, '该消息标识已经被使用', 'message_exists')
  }
  return id
}

type TaskInput = {
  title: string
  prompt: string
  model: string
  context?: DialogueMessage[]
  source: TaskSource
  state: TaskState
  conversationId?: string
  turnId?: string
  due?: Date
  reminder?: ReminderSpec
}

export async function createTask(db: Db, userId: string, input: TaskInput) {
  const { rows } = await db.query<TaskRow>(
    `
    INSERT INTO agent_tasks (id, user_id, title, prompt, model, context, source, state, conversation_id, turn_id, due_at, reminder)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
  `,
    [
      randomUUID(),
      userId,
      input.title,
      input.prompt,
      input.model,
      JSON.stringify(input.context ?? []),
      input.source,
      input.state,
      input.conversationId ?? null,
      input.turnId ?? null,
      input.due ?? null,
      input.reminder ?? null,
    ]
  )
  return rows[0]
}

export async function findTask(db: Db, userId: string, taskId: string) {
  const { rows } = await db.query<TaskRow>(
    'SELECT * FROM agent_tasks WHERE user_id = $1 AND id = $2 FOR UPDATE',
    [userId, taskId]
  )
  const task = rows[0]
  if (!task) {
    throw new HttpError(404, '任务不存在', 'not_found')
  }
  return task
}

export async function updateTask(db: Db, task: TaskRow, state: TaskState, due: Date | null = null) {
  await db.query(
    'UPDATE agent_tasks SET state = $2, due_at = $3, updated_at = now() WHERE id = $1',
    [task.id, state, due]
  )
  if (task.conversation_id && task.turn_id) {
    await db.query(
      `
      UPDATE chat_turns SET payload = jsonb_set(payload, '{task,status}', to_jsonb($3::text), false)
      WHERE conversation_id = $1 AND id = $2 AND payload ? 'task'
    `,
      [task.conversation_id, task.turn_id, state === 'scheduled' ? 'running' : state]
    )
  }
}

export async function listAgentState(
  db: Db,
  userId: string
): Promise<Pick<AgentState<Date>, 'items' | 'jobs'>> {
  const [messages, tasks] = await Promise.all([
    db.query<{ id: string; task_id: string | null; payload: ItemPayload; created_at: Date }>(
      `
      SELECT id, task_id, payload, created_at FROM (
        SELECT id, task_id, payload, created_at, sequence FROM agent_messages
        WHERE user_id = $1 ORDER BY created_at DESC, sequence DESC LIMIT 200
      ) AS recent ORDER BY created_at, sequence
    `,
      [userId]
    ),
    db.query<TaskRow & { is_reminder: boolean }>(
      `
      SELECT id, title, state, source, due_at, updated_at, enabled, reminder IS NOT NULL as is_reminder
      FROM agent_tasks WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100
    `,
      [userId]
    ),
  ])
  const jobs = tasks.rows.map((row) => ({
    id: row.id,
    title: row.title,
    state: row.state,
    source: row.source,
    dueAt: row.due_at,
    updatedAt: row.updated_at,
    enabled: row.enabled,
    reminder: row.is_reminder,
  }))
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const items = messages.rows.map(
    (row) =>
      ({
        ...row.payload,
        id: row.id,
        taskId: row.task_id,
        createdAt: row.created_at,
        ...(row.payload.kind === 'reminder'
          ? {
              enabled: byId.get(row.payload.reminderId)?.enabled ?? false,
              active: byId.get(row.payload.reminderId)?.state === 'scheduled',
            }
          : {}),
      }) as AgentItem<Date>
  )
  return { items, jobs }
}

export async function saveMemory(
  db: Db,
  userId: string,
  memory: Pick<Memory, 'id' | 'text'>,
  source: string
) {
  await db.query(
    `
    INSERT INTO agent_memories (id,user_id,body,source) VALUES ($1,$2,$3,$4)
    ON CONFLICT (id) DO UPDATE SET body = excluded.body
    WHERE agent_memories.user_id = excluded.user_id
  `,
    [memory.id, userId, memory.text, source]
  )
}
