import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, jsonBody, type AgentMessage, type AgentProfile } from '../../services/platform.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  IconMenuOutline20,
  IconSendOutline16,
  IconSettingsOutline16,
  IconThinkOutline14,
} from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Markdown } from '../markdown/Markdown.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { AgentOrb } from './AgentOrb.js'
import platformStyles from './Platform.module.css'
import styles from './AgentWorkspace.module.css'

const suggestions = [
  ['整理我的目标', '梳理我当前最重要的三个目标，并给出今天可以推进的一步。'],
  ['做一次计算', '请使用 calculator 工具计算 123 × 45，并告诉我结果。'],
  ['安排持续关注', '帮我规划一个值得长期跟进的事项，以及合适的检查节奏。'],
]

export const AgentWorkspace = ({ onOpenTasks }: { onOpenTasks: () => void }) => {
  const isMobile = useIsMobile()
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

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
  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'end',
    })
  }, [messages, busy])

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
      setNotice('Agent 的使命与工作约定已更新。')
      setSettingsOpen(false)
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
    const optimistic: AgentMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: task,
      trigger: 'chat',
      createdAt: Date.now(),
    }
    setMessages((items) => [...items, optimistic])
    setInput('')
    setBusy(true)
    setError('')
    try {
      await api('/api/agent/run', { method: 'POST', body: jsonBody({ input: task }) })
      await load()
    } catch (reason) {
      setMessages((items) => items.filter((item) => item.id !== optimistic.id))
      setInput(task)
      setError(reason instanceof Error ? reason.message : '任务执行失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.agentPage}>
      <header className={styles.header}>
        <div className={styles.identity}>
          {isMobile ? (
            <IconButton
              tone="primary"
              icon={<IconMenuOutline20 />}
              aria-label="打开侧栏"
              onClick={openMobileSider}
            />
          ) : null}
          <AgentOrb size="medium" active running={busy} />
          <div>
            <strong>{profile?.name ?? 'Personal Agent'}</strong>
            <span>{busy ? '正在处理任务' : '独立工作区 · 在线'}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button onClick={onOpenTasks}>
            <IconThinkOutline14 />
            <span>定时任务</span>
          </button>
          <IconButton
            tone="primary"
            icon={<IconSettingsOutline16 />}
            tooltip="Agent 设置"
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </header>
      <div className={styles.conversation}>
        <div className={styles.messageColumn}>
          {messages.length === 0 ? (
            <div className={styles.hero}>
              <AgentOrb size="large" active />
              <h1>把长期的事，交给你的 Agent。</h1>
              <p>它有自己的使命、历史和工具。你不需要在每个对话里重新交代目标。</p>
              <div className={styles.suggestions}>
                {suggestions.map(([label, value]) => (
                  <button key={label} onClick={() => setInput(value)}>
                    {label}
                    <span>{value}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                className={`${styles.messageRow} ${message.role === 'user' ? styles.userRow : styles.assistantRow}`}
                key={message.id}
              >
                {message.role === 'assistant' ? <AgentOrb size="small" active /> : null}
                <div className={styles.messageBody}>
                  {message.role === 'assistant' ? (
                    <div className={styles.messageAuthor}>{profile?.name ?? 'Personal Agent'}</div>
                  ) : null}
                  <div className={styles.messageText}>
                    {message.role === 'assistant' ? (
                      <Markdown
                        content={message.content}
                        loading={false}
                        cacheKey={message.id}
                        disableLink={false}
                      />
                    ) : (
                      message.content
                    )}
                  </div>
                  {message.trace?.length ? (
                    <div className={styles.traceCard}>
                      <div className={styles.traceTitle}>
                        <span className={styles.traceDot} /> 已调用 {message.trace.length} 个工具
                      </div>
                      {message.trace.map((trace, index) => (
                        <details key={`${trace.name}-${index}`}>
                          <summary>{trace.name}</summary>
                          <pre>
                            {JSON.stringify(trace.input, null, 2)}
                            {'\n\n'}
                            {trace.output}
                          </pre>
                        </details>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
          {busy && messages.at(-1)?.role === 'user' ? (
            <div className={styles.assistantRow}>
              <AgentOrb size="small" running />
              <div className={styles.working}>
                <span />
                <span />
                <span />
                正在理解任务
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>
      <div className={styles.composerArea}>
        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        <form className={styles.composer} onSubmit={run}>
          <textarea
            aria-label="给 Personal Agent 的任务"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void run()
              }
            }}
            placeholder="交给 Personal Agent 一个目标或任务…"
          />
          <button
            className={styles.send}
            type="submit"
            aria-label="执行任务"
            disabled={busy || !input.trim()}
          >
            <IconSendOutline16 />
          </button>
        </form>
        <div className={styles.composerHint}>独立历史 · 已授权工具 · 定时任务</div>
      </div>
      {settingsOpen && profile ? (
        <Modal
          title="Personal Agent 设置"
          closable
          className={styles.settingsModal}
          onClose={() => setSettingsOpen(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setSettingsOpen(false)}>
                取消
              </Button>
              <Button size="m" disabled={busy} onClick={() => void saveProfile()}>
                保存设置
              </Button>
            </>
          }
        >
          <div className={platformStyles.field}>
            <label htmlFor="agent-name">名称</label>
            <input
              id="agent-name"
              className={platformStyles.input}
              value={profile.name}
              onChange={(event) => setProfile({ ...profile, name: event.target.value })}
            />
          </div>
          <div className={platformStyles.field}>
            <label htmlFor="agent-mission">长期使命</label>
            <textarea
              id="agent-mission"
              className={platformStyles.textarea}
              value={profile.mission}
              onChange={(event) => setProfile({ ...profile, mission: event.target.value })}
            />
          </div>
          <div className={platformStyles.field}>
            <label htmlFor="agent-instructions">工作约定</label>
            <textarea
              id="agent-instructions"
              className={platformStyles.textarea}
              value={profile.instructions}
              onChange={(event) => setProfile({ ...profile, instructions: event.target.value })}
            />
          </div>
          <div className={platformStyles.field}>
            <label htmlFor="agent-autonomy">任务自主权</label>
            <select
              id="agent-autonomy"
              className={platformStyles.select}
              value={profile.autonomy}
              onChange={(event) =>
                setProfile({ ...profile, autonomy: event.target.value as 'confirm' | 'auto' })
              }
            >
              <option value="confirm">确认优先：定时任务不调用 Webhook</option>
              <option value="auto">授权后自动：允许定时任务调用已启用工具</option>
            </select>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
