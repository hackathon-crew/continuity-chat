import { PencilSimpleIcon, PlugsConnectedIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Octopus } from '../../vendor/inkpaw/Octopus'
import type { useAgent } from './useAgent'

type Uni = ReturnType<typeof useAgent>

export function AgentSettings({ uni }: { uni: Uni }) {
  const { profile, memories } = uni
  const [name, setName] = useState(profile.name)
  const [persona, setPersona] = useState(profile.persona)
  const [editing, setEditing] = useState<{ id?: string; text: string }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function change(action: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '未能保存设定')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="xb-settings__section">
      {error ? (
        <p className="qx-meta" role="alert">
          {error}
        </p>
      ) : null}
      <div className="xb-settings__identity">
        <Octopus size={64} res={32} mood="idle" label={profile.name} />
        <div className="qx-field xb-settings__grow">
          <label htmlFor="agent-name">名字</label>
          <input
            id="agent-name"
            className="qx-input"
            value={name}
            maxLength={28}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim()
              if (next && next !== profile.name) {
                void change(() => uni.patchProfile({ name: next }))
              } else {
                setName(profile.name)
              }
            }}
          />
        </div>
      </div>
      <div className="qx-field">
        <label htmlFor="agent-soul">性格和说话方式</label>
        <textarea
          id="agent-soul"
          className="qx-textarea"
          value={persona}
          maxLength={3000}
          onChange={(event) => setPersona(event.target.value)}
          onBlur={() => {
            if (persona !== profile.persona) {
              void change(() => uni.patchProfile({ persona }))
            }
          }}
        />
        <small>它每次回复前都会读这段话</small>
      </div>
      <div className="xb-settings__row">
        <div>
          <strong>主动找你</strong>
          <span className="qx-meta">到点提醒、事情有进展时发消息；23:00 到 8:00 不打扰</span>
        </div>
        <button
          type="button"
          className="qx-switch"
          role="switch"
          aria-checked={profile.proactive}
          aria-label="主动找你"
          disabled={busy}
          onClick={() =>
            void change(() =>
              uni.patchProfile({
                proactive: !profile.proactive,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })
            )
          }
        />
      </div>
      <div className="xb-settings__list">
        <div className="xb-settings__list-head">
          <h3 className="qx-heading">记忆</h3>
          <span className="qx-meta">{memories.length} 条，只有你能看到和修改</span>
        </div>
        {memories.map((memory) => (
          <div className="xb-memory" key={memory.id}>
            <div>
              <p>{memory.text}</p>
              <span className="qx-meta">{memory.from}</span>
            </div>
            <button
              type="button"
              className="qx-btn qx-btn--ghost qx-btn--icon"
              aria-label={`修改：${memory.text}`}
              onClick={() => setEditing(memory)}
            >
              <PencilSimpleIcon />
            </button>
            <button
              type="button"
              className="qx-btn qx-btn--ghost qx-btn--icon"
              aria-label={`删除：${memory.text}`}
              disabled={busy}
              onClick={() => void change(() => uni.changeMemory(memory.id))}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        {editing ? (
          <form
            className="qx-field"
            onSubmit={(event) => {
              event.preventDefault()
              void change(async () => {
                await uni.changeMemory(editing.id, editing.text)
                setEditing(undefined)
              })
            }}
          >
            <textarea
              className="qx-textarea"
              aria-label="记忆内容"
              autoFocus
              value={editing.text}
              maxLength={1800}
              onChange={(event) => setEditing({ ...editing, text: event.target.value })}
            />
            <div>
              <button
                type="submit"
                className="qx-btn qx-btn--primary"
                disabled={busy || !editing.text.trim()}
              >
                保存
              </button>
              <button
                type="button"
                className="qx-btn qx-btn--ghost"
                onClick={() => setEditing(undefined)}
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="qx-btn qx-btn--ghost xb-settings__add"
            onClick={() => setEditing({ text: '' })}
          >
            <PlusIcon aria-hidden="true" />
            添加一条记忆
          </button>
        )}
      </div>
    </div>
  )
}

export function ToolsSettings({ uni }: { uni: Uni }) {
  const [connecting, setConnecting] = useState(false)
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function change(action: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '工具设置未保存')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="xb-settings__section">
      <p className="qx-meta xb-settings__lede">对话和{uni.profile.name}都能用打开的工具。</p>
      {error ? (
        <p className="qx-meta" role="alert">
          {error}
        </p>
      ) : null}
      <div className="xb-settings__list">
        {uni.tools.map((tool) => (
          <div className="xb-settings__row" key={tool.id}>
            <div>
              <strong>
                {tool.name}
                <span className="qx-tag">内置</span>
              </strong>
              <span className="qx-meta">
                {tool.available ? tool.detail : '服务端需配置 Tavily'}
              </span>
            </div>
            <button
              type="button"
              className="qx-switch"
              role="switch"
              aria-checked={tool.on}
              aria-label={tool.name}
              disabled={busy || !tool.available}
              onClick={() => void change(() => uni.changeTool(tool))}
            />
          </div>
        ))}
      </div>
      <div className="xb-settings__row">
        <div>
          <strong>MCP 服务</strong>
          <span className="qx-meta">填入服务地址，把你自己的工具接进来</span>
        </div>
        <button
          type="button"
          className="qx-btn qx-btn--secondary"
          onClick={() => setConnecting((value) => !value)}
        >
          <PlugsConnectedIcon aria-hidden="true" />
          连接
        </button>
      </div>
      {connecting ? (
        <form
          className="qx-field"
          onSubmit={(event) => {
            event.preventDefault()
            void change(async () => {
              await uni.connectMcp(address.trim(), token.trim() || undefined)
              setAddress('')
              setToken('')
              setConnecting(false)
            })
          }}
        >
          <label htmlFor="mcp-url">服务地址</label>
          <input
            id="mcp-url"
            className="qx-input"
            type="url"
            value={address}
            placeholder="https://example.com/mcp"
            required
            onChange={(event) => setAddress(event.target.value)}
          />
          <label htmlFor="mcp-token">Bearer Token（可选）</label>
          <input
            id="mcp-token"
            className="qx-input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button type="submit" className="qx-btn qx-btn--primary" disabled={busy}>
            保存连接
          </button>
        </form>
      ) : null}
      {uni.mcpServers.map((server) => (
        <div className="xb-settings__row" key={server.id}>
          <span>{server.url}</span>
          <button
            className="qx-btn qx-btn--ghost"
            type="button"
            disabled={busy}
            onClick={() => void change(() => uni.removeMcp(server.id))}
          >
            移除
          </button>
        </div>
      ))}
    </div>
  )
}
