import { useEffect, useState, type FormEvent } from 'react'
import { api, jsonBody, type AgentMessage, type AgentProfile } from '../../services/platform.js'
import { Button } from '../base/Button.js'
import styles from './Platform.module.css'

export const AgentWorkspace = () => {
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    try {
      const result = await api<{ profile: AgentProfile; messages: AgentMessage[] }>('/api/agent')
      setProfile(result.profile)
      setMessages(result.messages)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Personal Agent 加载失败')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const saveProfile = async () => {
    if (!profile) {
      return
    }
    setBusy(true)
    try {
      const result = await api<{ profile: AgentProfile }>('/api/agent/profile', {
        method: 'PUT',
        body: jsonBody(profile),
      })
      setProfile(result.profile)
      setNotice('Personal Agent 的使命与工作约定已更新。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const run = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!input.trim() || busy) {
      return
    }
    const task = input.trim()
    setInput('')
    setBusy(true)
    setError('')
    try {
      await api('/api/agent/run', { method: 'POST', body: jsonBody({ input: task }) })
      await load()
    } catch (reason) {
      setInput(task)
      setError(reason instanceof Error ? reason.message : '任务执行失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.pageEyebrow}>Independent Agent</div>
          <h1 className={styles.pageTitle}>Personal Agent</h1>
          <p className={styles.pageDescription}>
            它拥有独立的使命、历史和任务，不混入陪伴会话。借鉴 DeepSeek Superagent
            的触发、授权、执行与结果投递方式。
          </p>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <p className={styles.status}>{notice}</p> : null}
      <div className={styles.agentLayout}>
        <section className={`${styles.card} ${styles.agentChat}`}>
          <div className={styles.agentMessages}>
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                这里不是另一个聊天窗口。
                <br />
                给它一个需要持续推进的目标，或到“自动化”里安排独立任务。
              </div>
            ) : (
              messages.map((message) => (
                <div
                  className={`${styles.agentMessage} ${message.role === 'user' ? styles.agentMessageUser : styles.agentMessageAssistant}`}
                  key={message.id}
                >
                  {message.content}
                  {message.trace?.length ? (
                    <div className={styles.trace}>
                      {message.trace.map((trace, index) => (
                        <details key={`${trace.name}-${index}`}>
                          <summary>调用 {trace.name}</summary>
                          <pre>
                            {JSON.stringify(trace.input, null, 2)}\n\n{trace.output}
                          </pre>
                        </details>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {busy ? (
              <div className={`${styles.agentMessage} ${styles.agentMessageAssistant}`}>
                正在理解任务并调用可用工具…
              </div>
            ) : null}
          </div>
          <form className={styles.agentInput} onSubmit={run}>
            <textarea
              className={styles.textarea}
              aria-label="给 Personal Agent 的任务"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：帮我分析这份计划，列出今天可以推进的三件事。"
            />
            <Button type="submit" size="m" disabled={busy || !input.trim()}>
              执行
            </Button>
          </form>
        </section>
        {profile ? (
          <aside className={styles.card}>
            <h2 className={styles.cardTitle}>使命与授权</h2>
            <p className={styles.cardDescription}>
              自主模式只影响已启用工具；外部敏感操作仍应单独确认。
            </p>
            <div className={styles.field}>
              <label htmlFor="agent-name">名称</label>
              <input
                id="agent-name"
                className={styles.input}
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="agent-mission">长期使命</label>
              <textarea
                id="agent-mission"
                className={styles.textarea}
                value={profile.mission}
                onChange={(event) => setProfile({ ...profile, mission: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="agent-instructions">工作约定</label>
              <textarea
                id="agent-instructions"
                className={styles.textarea}
                value={profile.instructions}
                onChange={(event) => setProfile({ ...profile, instructions: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="agent-autonomy">任务自主权</label>
              <select
                id="agent-autonomy"
                className={styles.select}
                value={profile.autonomy}
                onChange={(event) =>
                  setProfile({ ...profile, autonomy: event.target.value as 'confirm' | 'auto' })
                }
              >
                <option value="confirm">确认优先：定时任务不调用 Webhook</option>
                <option value="auto">授权后自动：允许定时任务调用已启用工具</option>
              </select>
            </div>
            <Button size="m" disabled={busy} onClick={() => void saveProfile()}>
              保存 Agent 设置
            </Button>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
