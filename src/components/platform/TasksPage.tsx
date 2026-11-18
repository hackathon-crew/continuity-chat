import { useEffect, useState } from 'react'
import { api, jsonBody, type ScheduleTask } from '../../services/platform.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import styles from './Platform.module.css'

const taskSchedule = (task: ScheduleTask) =>
  task.kind === 'once'
    ? `一次 · ${new Date(task.runAt ?? '').toLocaleString()}`
    : task.kind === 'interval'
      ? `每 ${task.intervalMinutes} 分钟`
      : `每天 ${task.timeOfDay} · ${task.timeZone}`

export const TasksPage = () => {
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [tasks, setTasks] = useState<ScheduleTask[]>([])
  const [target, setTarget] = useState<'companion' | 'agent'>('companion')
  const [kind, setKind] = useState<'once' | 'interval' | 'daily'>('daily')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [runAt, setRunAt] = useState('')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [timeOfDay, setTimeOfDay] = useState('09:00')
  const [sessionId, setSessionId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setTasks((await api<{ tasks: ScheduleTask[] }>('/api/tasks')).tasks)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务加载失败')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    setBusy('create')
    setError('')
    try {
      const selected = sessions.find((item) => item.id === (sessionId || activeId))
      await api('/api/tasks', {
        method: 'POST',
        body: jsonBody({
          title,
          prompt,
          target,
          kind,
          sessionId: target === 'companion' ? (selected?.id ?? null) : null,
          sessionTitle: selected?.title || '主动消息',
          runAt: runAt ? new Date(runAt).toISOString() : null,
          intervalMinutes,
          timeOfDay,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      setTitle('')
      setPrompt('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务创建失败')
    } finally {
      setBusy('')
    }
  }

  const runNow = async (id: string) => {
    setBusy(id)
    setError('')
    try {
      await api(`/api/tasks/${id}/run`, { method: 'POST' })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '执行失败')
    } finally {
      setBusy('')
    }
  }

  const patch = async (id: string, update: object) => {
    setBusy(id)
    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: jsonBody(update) })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务更新失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.pageEyebrow}>Automation</div>
          <h1 className={styles.pageTitle}>让关系和工作，不必一直等待</h1>
          <p className={styles.pageDescription}>
            定时任务可以投向普通会话的主动消息，也可以交给独立 Personal
            Agent。所有执行结果和错误都留在这里。
          </p>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>创建定时任务</h2>
        <p className={styles.cardDescription}>
          主动消息遵守 Soul 设置中的免打扰时段；“立即执行”用于验证真实模型和工具链路。
        </p>
        <div className={styles.gridTwo}>
          <div className={styles.field}>
            <label htmlFor="task-title">任务名称</label>
            <input
              id="task-title"
              className={styles.input}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="晚安问候 / 每日目标整理"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="task-target">交给谁</label>
            <select
              id="task-target"
              className={styles.select}
              value={target}
              onChange={(event) => setTarget(event.target.value as 'companion' | 'agent')}
            >
              <option value="companion">AI 伙伴 · 主动消息</option>
              <option value="agent">Personal Agent · 独立任务</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="task-kind">频率</label>
            <select
              id="task-kind"
              className={styles.select}
              value={kind}
              onChange={(event) => setKind(event.target.value as 'once' | 'interval' | 'daily')}
            >
              <option value="daily">每天</option>
              <option value="interval">按分钟间隔</option>
              <option value="once">指定时间一次</option>
            </select>
          </div>
          {kind === 'daily' ? (
            <div className={styles.field}>
              <label htmlFor="task-time">执行时间</label>
              <input
                id="task-time"
                type="time"
                className={styles.input}
                value={timeOfDay}
                onChange={(event) => setTimeOfDay(event.target.value)}
              />
            </div>
          ) : null}
          {kind === 'interval' ? (
            <div className={styles.field}>
              <label htmlFor="task-interval">间隔分钟</label>
              <input
                id="task-interval"
                type="number"
                min={1}
                max={10080}
                className={styles.input}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              />
            </div>
          ) : null}
          {kind === 'once' ? (
            <div className={styles.field}>
              <label htmlFor="task-once">执行日期与时间</label>
              <input
                id="task-once"
                type="datetime-local"
                className={styles.input}
                value={runAt}
                onChange={(event) => setRunAt(event.target.value)}
              />
            </div>
          ) : null}
        </div>
        {target === 'companion' && sessions.length ? (
          <div className={styles.field}>
            <label htmlFor="task-session">投递到会话</label>
            <select
              id="task-session"
              className={styles.select}
              value={sessionId || activeId || ''}
              onChange={(event) => setSessionId(event.target.value)}
            >
              {sessions.map((session) => (
                <option value={session.id} key={session.id}>
                  {session.title || '新对话'}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={styles.field}>
          <label htmlFor="task-prompt">执行内容</label>
          <textarea
            id="task-prompt"
            className={styles.textarea}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              target === 'companion'
                ? '例如：根据我们的相处方式，发一条不催促回复的晚安消息。'
                : '例如：整理本周目标的进展，并给出下一步建议。'
            }
          />
        </div>
        <Button
          size="m"
          disabled={busy !== '' || !title.trim() || !prompt.trim() || (kind === 'once' && !runAt)}
          onClick={() => void create()}
        >
          {busy === 'create' ? '正在创建…' : '创建任务'}
        </Button>
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>任务与执行记录</h2>
        {tasks.length === 0 ? (
          <div className={styles.emptyState}>还没有定时任务。创建后可以立即执行一次验证效果。</div>
        ) : (
          tasks.map((task) => (
            <article className={styles.taskItem} key={task.id}>
              <div className={styles.taskTop}>
                <div>
                  <strong>{task.title}</strong>{' '}
                  <span className={styles.badge}>
                    {task.target === 'agent' ? 'Personal Agent' : '主动消息'}
                  </span>
                </div>
                <div>
                  <button
                    className={styles.iconTextButton}
                    disabled={busy !== ''}
                    onClick={() => void runNow(task.id)}
                  >
                    {busy === task.id ? '执行中…' : '立即执行'}
                  </button>
                  <button
                    className={styles.iconTextButton}
                    onClick={() => void patch(task.id, { enabled: !task.enabled })}
                  >
                    {task.enabled ? '暂停' : '开启'}
                  </button>
                  <button
                    className={styles.iconTextButton}
                    onClick={() => {
                      void api(`/api/tasks/${task.id}`, { method: 'DELETE' }).then(load)
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className={styles.taskMeta}>
                {taskSchedule(task)} · 下次{' '}
                {task.enabled ? new Date(task.nextRunAt).toLocaleString() : '已暂停'}
                {task.sessionTitle && task.target === 'companion' ? ` · ${task.sessionTitle}` : ''}
              </div>
              <p className={styles.taskPrompt}>{task.prompt}</p>
              {task.lastError ? (
                <div className={styles.error}>最近执行失败：{task.lastError}</div>
              ) : null}
              {task.lastResult ? (
                <div className={styles.status}>最近结果：{task.lastResult}</div>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  )
}
