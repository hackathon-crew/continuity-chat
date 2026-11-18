import { useEffect, useState } from 'react'
import {
  api,
  jsonBody,
  type CompanionProfile,
  type Soul,
  type Tool,
} from '../../services/platform.js'
import { Button } from '../base/Button.js'
import styles from './Platform.module.css'

export const CompanionStudio = () => {
  const [profile, setProfile] = useState<CompanionProfile | null>(null)
  const [soul, setSoul] = useState<Soul | null>(null)
  const [tools, setTools] = useState<Tool[]>([])
  const [memory, setMemory] = useState('')
  const [category, setCategory] = useState('偏好')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [toolForm, setToolForm] = useState(false)
  const [newTool, setNewTool] = useState({ name: '', description: '', url: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const result = await api<{ profile: CompanionProfile; tools: Tool[] }>('/api/workspace')
      setProfile(result.profile)
      setSoul(result.profile.soul)
      setTools(result.tools)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工作区加载失败')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const saveSoul = async () => {
    if (!soul || !profile) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api<{ profile: CompanionProfile }>('/api/soul', {
        method: 'PUT',
        body: jsonBody({ ...soul, proactive: profile.proactive }),
      })
      setProfile(result.profile)
      setSoul(result.profile.soul)
      setNotice('Soul 与主动消息偏好已保存，下一轮聊天开始生效。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const addMemory = async () => {
    if (!memory.trim()) {
      return
    }
    setBusy(true)
    try {
      await api('/api/memories', { method: 'POST', body: jsonBody({ content: memory, category }) })
      setMemory('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '记忆保存失败')
    } finally {
      setBusy(false)
    }
  }

  const patchMemory = async (id: string, update: object) => {
    try {
      await api(`/api/memories/${id}`, { method: 'PATCH', body: jsonBody(update) })
      await load()
      setEditing(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '记忆更新失败')
    }
  }

  const patchTool = async (id: string, update: object) => {
    try {
      const result = await api<{ tool: Tool }>(`/api/tools/${id}`, {
        method: 'PATCH',
        body: jsonBody(update),
      })
      setTools((items) => items.map((item) => (item.id === id ? result.tool : item)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工具更新失败')
    }
  }

  const addTool = async () => {
    setBusy(true)
    try {
      await api('/api/tools', {
        method: 'POST',
        body: jsonBody({
          type: 'webhook',
          name: newTool.name,
          description: newTool.description,
          config: { url: newTool.url },
        }),
      })
      setNewTool({ name: '', description: '', url: '' })
      setToolForm(false)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工具创建失败')
    } finally {
      setBusy(false)
    }
  }

  if (!soul || !profile) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>{error || '正在打开伙伴工作区…'}</div>
      </div>
    )
  }

  const soulField = (key: keyof Soul, label: string, multiline = false) => (
    <div className={styles.field}>
      <label htmlFor={`soul-${key}`}>{label}</label>
      {multiline ? (
        <textarea
          id={`soul-${key}`}
          className={styles.textarea}
          value={soul[key]}
          onChange={(event) => setSoul({ ...soul, [key]: event.target.value })}
        />
      ) : (
        <input
          id={`soul-${key}`}
          className={styles.input}
          value={soul[key]}
          onChange={(event) => setSoul({ ...soul, [key]: event.target.value })}
        />
      )}
    </div>
  )

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.pageEyebrow}>Companion Studio</div>
          <h1 className={styles.pageTitle}>让 TA 像你熟悉的样子</h1>
          <p className={styles.pageDescription}>
            Soul 决定相处方式，Memory 保存值得记住的事，Tools
            扩展可执行能力。所有内容都可以随时修改或停用。
          </p>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <p className={styles.status}>{notice}</p> : null}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Soul · 性格与关系</h2>
        <p className={styles.cardDescription}>
          这里不是不可修改的人设卡，而是你与 AI 共同维护的相处约定。
        </p>
        <div className={styles.gridTwo}>
          {soulField('companionName', 'TA 的名字')}
          {soulField('userName', 'TA 如何称呼你')}
        </div>
        {soulField('relationship', '你们的关系')}
        {soulField('personality', '性格', true)}
        {soulField('speakingStyle', '说话方式', true)}
        {soulField('boundaries', '边界与不希望出现的表达', true)}
        {soulField('customInstructions', '其他自定义指令', true)}
        <div className={styles.gridTwo}>
          <div className={styles.field}>
            <label htmlFor="quiet-start">主动消息免打扰开始</label>
            <input
              id="quiet-start"
              type="time"
              className={styles.input}
              value={profile.proactive.quietStart}
              onChange={(event) =>
                setProfile({
                  ...profile,
                  proactive: { ...profile.proactive, quietStart: event.target.value },
                })
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="quiet-end">免打扰结束</label>
            <input
              id="quiet-end"
              type="time"
              className={styles.input}
              value={profile.proactive.quietEnd}
              onChange={(event) =>
                setProfile({
                  ...profile,
                  proactive: { ...profile.proactive, quietEnd: event.target.value },
                })
              }
            />
          </div>
        </div>
        <div className={styles.actions}>
          <Button size="m" disabled={busy} onClick={() => void saveSoul()}>
            保存 Soul 与偏好
          </Button>
          <button
            className={styles.linkButton}
            onClick={() =>
              setProfile({
                ...profile,
                proactive: { ...profile.proactive, enabled: !profile.proactive.enabled },
              })
            }
          >
            {profile.proactive.enabled ? '已允许主动消息，点击暂停' : '已暂停主动消息，点击开启'}
          </button>
        </div>
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Memory · 用户掌控的记忆</h2>
        <p className={styles.cardDescription}>
          只保存你愿意留下的内容。停用后不会进入后续对话上下文。
        </p>
        <div className={styles.gridTwo}>
          <div className={styles.field}>
            <label htmlFor="memory-content">新记忆</label>
            <textarea
              id="memory-content"
              className={styles.textarea}
              value={memory}
              onChange={(event) => setMemory(event.target.value)}
              placeholder="例如：我回答压力问题时，更希望先被倾听，再一起讨论办法。"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="memory-category">分类</label>
            <select
              id="memory-category"
              className={styles.select}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {['偏好', '关系', '经历', '目标', '边界', '其他'].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <Button size="m" disabled={!memory.trim() || busy} onClick={() => void addMemory()}>
              添加记忆
            </Button>
          </div>
        </div>
        {profile.memories.length === 0 ? (
          <div className={styles.emptyState}>还没有记忆。可以从一条简单的偏好开始。</div>
        ) : (
          profile.memories.map((item) => (
            <div
              className={`${styles.memoryItem} ${item.enabled ? '' : styles.memoryItemDisabled}`}
              key={item.id}
            >
              <div className={styles.memoryTop}>
                <span className={styles.badge}>{item.category}</span>
                <div>
                  <button
                    className={styles.iconTextButton}
                    onClick={() => void patchMemory(item.id, { enabled: !item.enabled })}
                  >
                    {item.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    className={styles.iconTextButton}
                    onClick={() => {
                      setEditing(item.id)
                      setEditText(item.content)
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className={styles.iconTextButton}
                    onClick={() => {
                      void api(`/api/memories/${item.id}`, { method: 'DELETE' }).then(load)
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              {editing === item.id ? (
                <div className={styles.actions}>
                  <textarea
                    className={styles.textarea}
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                  />
                  <Button size="s" onClick={() => void patchMemory(item.id, { content: editText })}>
                    保存
                  </Button>
                </div>
              ) : (
                <div className={styles.memoryContent}>{item.content}</div>
              )}
            </div>
          ))
        )}
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Tools · 可自定义能力</h2>
        <p className={styles.cardDescription}>
          Personal Agent 可以真实调用这些工具。网页读取会阻止内网地址；自定义 Webhook
          只发送模型提供的工具输入。
        </p>
        {tools.map((tool) => (
          <div className={styles.toolRow} key={tool.id}>
            <div>
              <div className={styles.toolName}>{tool.name}</div>
              <div className={styles.toolDescription}>
                {tool.description}
                {tool.type === 'webhook' ? ` · ${tool.config.url}` : ''}
              </div>
            </div>
            <div>
              <button
                role="switch"
                aria-checked={tool.enabled}
                aria-label={`${tool.enabled ? '停用' : '启用'} ${tool.name}`}
                className={`${styles.switch} ${tool.enabled ? styles.switchOn : ''}`}
                onClick={() => void patchTool(tool.id, { enabled: !tool.enabled })}
              />
              {tool.type === 'webhook' ? (
                <button
                  className={styles.iconTextButton}
                  onClick={() => {
                    void api(`/api/tools/${tool.id}`, { method: 'DELETE' }).then(load)
                  }}
                >
                  删除
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {toolForm ? (
          <div className={styles.gridTwo}>
            <div className={styles.field}>
              <label htmlFor="tool-name">工具英文名</label>
              <input
                id="tool-name"
                className={styles.input}
                value={newTool.name}
                onChange={(event) => setNewTool({ ...newTool, name: event.target.value })}
                placeholder="lookup_order"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="tool-url">HTTPS Webhook 地址</label>
              <input
                id="tool-url"
                className={styles.input}
                value={newTool.url}
                onChange={(event) => setNewTool({ ...newTool, url: event.target.value })}
                placeholder="https://example.com/tool"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="tool-description">给模型看的工具说明</label>
              <textarea
                id="tool-description"
                className={styles.textarea}
                value={newTool.description}
                onChange={(event) => setNewTool({ ...newTool, description: event.target.value })}
              />
            </div>
            <div className={styles.actions}>
              <Button size="m" disabled={busy} onClick={() => void addTool()}>
                创建 Webhook 工具
              </Button>
            </div>
          </div>
        ) : null}
        <div className={styles.actions}>
          <Button variant="outlined" size="m" onClick={() => setToolForm(!toolForm)}>
            {toolForm ? '收起' : '添加自定义工具'}
          </Button>
        </div>
      </section>
    </div>
  )
}
