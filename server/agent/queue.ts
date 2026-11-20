import type { ConversationToolStep } from '../../contract/types.ts'
import type {
  CoreServices,
  Db,
  DialogueMessage,
  ProfileRow,
  ReminderSpec,
  StoredTurn,
  TaskRow,
  TaskSource,
  UserRow,
} from '../types.ts'
import { randomUUID } from 'node:crypto'
import { PgBoss, type JobWithMetadata } from 'pg-boss'
import { HttpError } from '../http.ts'
import { runModel, type ModelEffects } from './model.ts'
import {
  agentMemories,
  agentProfile,
  appendItem,
  createTask,
  findTask,
  saveMemory,
  updateTask,
} from './repository.ts'
import { nextReminder, quietUntil } from './time.ts'

type TicketSource = Exclude<TaskSource, 'legacy'>
type SendMessage = {
  text: string
  model: string
  taskId?: string
  messageId: string
  context: DialogueMessage[]
}

const queueName = 'uni-task'
const jobTimeout = 180_000
const streamFlushMs = 350

function reportError(error: unknown) {
  process.stderr.write(`Uni task: ${(error as Error).message}\n`)
}

export async function startAgent(services: CoreServices) {
  const { settings, store } = services
  const boss = new PgBoss(settings.databaseUrl)
  boss.on('error', reportError)
  await boss.start()
  await boss.createQueue(queueName, { retryLimit: 1, retryDelay: 10, expireInSeconds: 210 })

  async function enqueue(
    db: Db,
    task: TaskRow,
    source: TicketSource,
    prompt: string,
    at?: Date | null
  ) {
    const id = randomUUID()
    await db.query('INSERT INTO agent_tickets (id, task_id, source, prompt) VALUES ($1,$2,$3,$4)', [
      id,
      task.id,
      source,
      prompt,
    ])
    const job = await boss.send(
      queueName,
      { ticketId: id },
      {
        id,
        startAfter: at ?? undefined,
        db: { executeSql: (sql, args) => db.query(sql, args) },
      }
    )
    if (!job) {
      throw new Error('Uni task was not queued')
    }
  }

  async function handoff(
    user: UserRow,
    conversationId: string,
    turn: StoredTurn,
    context: DialogueMessage[],
    model: string
  ) {
    const profile = await agentProfile(store.db, user.id)
    return store.transaction(async (db) => {
      const task = await createTask(db, user.id, {
        title: turn.question.slice(0, 100),
        prompt: turn.question,
        model,
        context,
        source: 'chat',
        state: 'running',
        conversationId,
        turnId: turn.id,
      })
      const receipt: StoredTurn = {
        ...turn,
        answer: `交给 ${profile.name} 了。有结果时，它会在自己的对话里告诉你。`,
        streaming: false,
        task: { id: task.id, title: task.title, status: 'running' },
      }
      await db.query('UPDATE chat_turns SET payload = $3 WHERE conversation_id = $1 AND id = $2', [
        conversationId,
        turn.id,
        receipt,
      ])
      await appendItem(db, user.id, task.id, { kind: 'user', text: turn.question })
      await enqueue(db, task, 'chat', turn.question)
      return receipt
    })
  }

  async function send(user: UserRow, { text, model, taskId, messageId, context }: SendMessage) {
    return store.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [messageId])
      const { rows } = await db.query<{ task_id: string }>(
        'SELECT task_id FROM agent_messages WHERE user_id = $1 AND id = $2',
        [user.id, messageId]
      )
      if (rows[0]) {
        return { taskId: rows[0].task_id }
      }
      let task
      if (taskId) {
        task = await findTask(db, user.id, taskId)
        if (!['waiting', 'failed'].includes(task.state) || task.reminder) {
          throw new HttpError(409, '这项任务还不能继续', 'invalid_task_state')
        }
        await updateTask(db, task, 'running')
        if (context.length) {
          await db.query('UPDATE agent_tasks SET context = context || $2::jsonb WHERE id = $1', [
            task.id,
            JSON.stringify(context),
          ])
        }
      } else {
        task = await createTask(db, user.id, {
          title: text.slice(0, 100),
          prompt: text,
          model,
          context,
          source: 'agent',
          state: 'running',
        })
      }
      await appendItem(db, user.id, task.id, { kind: 'user', text }, messageId)
      await enqueue(db, task, 'agent', text)
      return { taskId: task.id }
    })
  }

  async function publishEffects(
    db: Db,
    user: UserRow,
    model: string,
    effects: ModelEffects,
    taskId: string | null = null
  ) {
    const attachments = []
    for (const file of effects.files) {
      await db.query('INSERT INTO agent_files (id,user_id,name,content) VALUES ($1,$2,$3,$4)', [
        file.id,
        user.id,
        file.name,
        file.content,
      ])
      const item = {
        kind: 'file' as const,
        name: file.name,
        meta: `演示文稿 · ${file.pages} 页`,
        fileId: file.id,
      }
      await appendItem(db, user.id, taskId, item)
      attachments.push(item)
    }
    for (const memory of effects.memories) {
      await saveMemory(db, user.id, memory, '对话')
    }
    for (const reminder of effects.reminders) {
      const due = new Date(reminder.at)
      const task = await createTask(db, user.id, {
        title: reminder.title,
        prompt: reminder.message,
        source: 'timer',
        state: 'scheduled',
        model,
        due,
        reminder: { repeat: reminder.repeat, targetAt: reminder.at },
      })
      await enqueue(db, task, 'timer', reminder.message, due)
      await appendItem(db, user.id, task.id, {
        kind: 'reminder',
        reminderId: task.id,
        title: task.title,
        rule: reminder.repeat,
        at: reminder.at,
      })
    }
    return attachments
  }

  async function closeTicket(db: Db, id: string) {
    await db.query('UPDATE agent_tickets SET closed_at = now() WHERE id = $1', [id])
  }

  async function deliverReminder(task: TaskRow, ticket: string, profile: ProfileRow) {
    await store.transaction(async (db) => {
      const current = await findTask(db, task.user_id, task.id)
      if (!current.enabled) {
        await updateTask(db, task, 'done')
        await closeTicket(db, ticket)
        return
      }
      const quiet = profile.proactive ? quietUntil(new Date(), profile.timezone) : null
      if (quiet) {
        await updateTask(db, task, 'scheduled', quiet)
        await enqueue(db, task, 'timer', task.prompt, quiet)
      } else {
        if (profile.proactive) {
          await appendItem(db, task.user_id, task.id, { kind: 'agent', text: task.prompt }, ticket)
        }
        const reminder = task.reminder as ReminderSpec
        const next = nextReminder(new Date(reminder.targetAt), reminder.repeat, profile.timezone)
        await updateTask(db, task, next ? 'scheduled' : 'done', next)
        if (next) {
          await enqueue(db, task, 'timer', task.prompt, next)
        }
      }
      await closeTicket(db, ticket)
    })
  }

  async function taskMessages(task: TaskRow, prompt: string, ticketId: string) {
    const { rows } = await store.db.query<{ payload: { kind: 'agent' | 'user'; text: string } }>(
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
    const messages: DialogueMessage[] = [
      ...task.context,
      ...rows.map<DialogueMessage>(({ payload }) => ({
        role: payload.kind === 'agent' ? 'assistant' : 'user',
        content: payload.text,
      })),
    ]
    if (messages.at(-1)?.content !== prompt) {
      messages.push({ role: 'user', content: prompt })
    }
    return messages
  }

  async function runTicket(job: JobWithMetadata<{ ticketId: string }>) {
    const ticketId = job.data.ticketId
    const { rows } = await store.db.query<
      TaskRow & { wake_prompt: string; wake_source: TicketSource }
    >(
      `
      SELECT task.*, ticket.prompt AS wake_prompt, ticket.source AS wake_source
      FROM agent_tickets ticket JOIN agent_tasks task ON task.id = ticket.task_id
      WHERE ticket.id = $1 AND ticket.closed_at IS NULL
    `,
      [ticketId]
    )
    const task = rows[0]
    if (!task) {
      return
    }
    try {
      const profile = await agentProfile(store.db, task.user_id)
      if (task.reminder) {
        await deliverReminder(task, ticketId, profile)
        return
      }
      if (task.wake_source === 'timer' && !profile.proactive) {
        await store.transaction(async (db) => {
          await updateTask(db, task, 'waiting')
          await closeTicket(db, ticketId)
        })
        return
      }
      const quiet = task.wake_source === 'timer' ? quietUntil(new Date(), profile.timezone) : null
      if (quiet) {
        await store.transaction(async (db) => {
          await updateTask(db, task, 'scheduled', quiet)
          await enqueue(db, task, 'timer', task.wake_prompt, quiet)
          await closeTicket(db, ticketId)
        })
        return
      }
      await updateTask(store.db, task, 'running')
      const user = await store.user(task.user_id)
      const memories = await agentMemories(store.db, user.id)
      const messages = await taskMessages(task, task.wake_prompt, ticketId)
      const steps = new Map<string, ConversationToolStep>()
      let lastFlush = 0
      const result = await runModel({
        store,
        settings,
        user,
        profile,
        memories,
        messages,
        model: task.model,
        task,
        search: true,
        signal: AbortSignal.timeout(jobTimeout),
        onStep: (step) => {
          steps.set(step.id, step)
        },
        onDelta: async (_, partial) => {
          if (Date.now() - lastFlush >= streamFlushMs) {
            await appendItem(
              store.db,
              user.id,
              task.id,
              { kind: 'agent', text: partial, streaming: true },
              ticketId
            )
            lastFlush = Date.now()
          }
        },
      })
      await store.transaction(async (db) => {
        if (steps.size) {
          await appendItem(db, user.id, task.id, { kind: 'activity', steps: [...steps.values()] })
        }
        const text =
          result.text ||
          (result.effects.files.length ? '文件做好了。' : '这次任务没有生成可用的回复。')
        await appendItem(db, user.id, task.id, { kind: 'agent', text }, ticketId)
        await publishEffects(db, user, task.model, result.effects, task.id)
        const disposition: NonNullable<ModelEffects['disposition']> = result.effects
          .disposition ?? {
          status: result.text || result.effects.files.length ? 'done' : 'failed',
        }
        const due = disposition.at ? new Date(disposition.at) : null
        await updateTask(db, task, disposition.status, due)
        if (disposition.status === 'scheduled') {
          await enqueue(db, task, 'timer', '到约定时间了，请接着推进任务。', due)
        }
        await closeTicket(db, ticketId)
      })
    } catch (error) {
      if (job.retryCount >= job.retryLimit) {
        await store.transaction(async (db) => {
          await appendItem(
            db,
            task.user_id,
            task.id,
            { kind: 'agent', text: '这次任务没有完成。可以从「任务与提醒」继续。' },
            ticketId
          )
          await updateTask(db, task, 'failed')
          await closeTicket(db, ticketId)
        })
      }
      reportError(error)
      throw error
    }
  }

  const workOptions = { includeMetadata: true, localConcurrency: 2 } as const
  await boss.work<{ ticketId: string }, unknown, typeof workOptions>(
    queueName,
    workOptions,
    async ([job]) => runTicket(job)
  )
  return { handoff, send, publishEffects, stop: () => boss.stop(), enqueue }
}
