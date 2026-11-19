import {
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApplicationFrame } from '../everplain/app/application-frame/ApplicationFrame'
import '../everplain/app/application-frame/application-frame.css'
import { NavIcon } from '../everplain/app/ui/NavIcon'
import { AgentPage } from './AgentPage'
import { ApiError, json, listModels } from './api'
import { ChatPage } from './ChatPage'
import { agent, type Billing, type ConversationSummary, type Model, type User } from './data'
import { ImportDialog } from './ImportDialog'
import { LoginPage } from './LoginPage'
import { BrandName, OctoMark } from './parts'
import { SettingsDialog, type Scheme, type SettingsTab } from './SettingsDialog'
import { useConversations } from './useConversations'
import './app.css'

type View = { kind: 'agent' } | { kind: 'chat'; id: string }

function useNarrow() {
  const query = '(max-width: 760px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

const authMessages: Record<string, string> = {
  denied: '授权已取消。你可以重新发起登录。',
  expired: '登录请求已过期。请重新发起登录。',
  permission: '这个 UniGate 账号暂未开通聊天权限。',
  unavailable: 'UniGate 授权未完成。请确认你能打开 UniGate 控制台后重新登录。',
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成'
}

export function App() {
  const narrow = useNarrow()
  const [user, setUser] = useState<User | null | undefined>()
  const [billing, setBilling] = useState<Billing>()
  const [models, setModels] = useState<Model[]>([])
  const [error, setError] = useState(
    () => authMessages[new URLSearchParams(location.search).get('auth') ?? '']
  )
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [view, setView] = useState<View>({ kind: 'agent' })
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [importing, setImporting] = useState(false)
  const [scheme, setScheme] = useState<Scheme>(() => {
    const stored = localStorage.getItem('unigate-scheme')
    return stored === 'dark' || stored === 'light' ? stored : 'system'
  })
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  const refreshBilling = useCallback(async (page = 1) => {
    try {
      setBilling(await json<Billing>(`/api/billing?page=${page}`))
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setUser(null)
      }
      setError(errorText(failure))
    }
  }, [])
  const workspace = useConversations(setError, refreshBilling)
  const loadList = useRef(workspace.loadList)

  useEffect(() => {
    let done = false
    void json<User>('/api/auth/me').then(
      (current) => {
        if (done) {
          return
        }
        setUser(current)
        void loadList.current().catch((failure) => setError(errorText(failure)))
        void listModels().then(setModels, (failure) => setError(errorText(failure)))
        void refreshBilling()
      },
      (failure) => {
        if (!done) {
          setUser(null)
          if (!(failure instanceof ApiError && failure.status === 401)) {
            setError(errorText(failure))
          }
        }
      }
    )
    return () => {
      done = true
    }
  }, [refreshBilling])

  useEffect(() => {
    const root = document.documentElement
    if (scheme === 'system') {
      root.removeAttribute('data-color-scheme')
    } else {
      root.setAttribute('data-color-scheme', scheme)
    }
    localStorage.setItem('unigate-scheme', scheme)
  }, [scheme])

  const current =
    view.kind === 'chat' ? workspace.chats.find((chat) => chat.id === view.id) : undefined
  const defaultModel =
    models.find((model) => model.provider === 'deepseek')?.id ?? models[0]?.id ?? ''

  function go(next: View) {
    setError('')
    setView(next)
    if (narrow) {
      setDrawer(false)
    }
    if (next.kind === 'chat') {
      void workspace.open(next.id).catch((failure) => setError(errorText(failure)))
    }
  }

  function newChat() {
    go({ kind: 'chat', id: workspace.startDraft(defaultModel) })
  }

  function imported(rows: ConversationSummary[]) {
    setImporting(false)
    for (const row of rows) {
      workspace.storeChat(row)
    }
    if (rows[0]) {
      go({ kind: 'chat', id: rows[0].id })
    }
  }

  async function signOut() {
    await json('/api/auth/logout', 'POST')
    workspace.reset()
    setUser(null)
    setBilling(undefined)
    setModels([])
    setSettings(null)
    setView({ kind: 'agent' })
  }

  const openImport = () => {
    setImporting(true)
    setDrawer(false)
  }
  const openSettings = (tab: SettingsTab) => {
    setDrawer(false)
    setSettings(tab)
    if (tab === 'account') {
      void refreshBilling()
    }
  }
  const shown = workspace.chats
    .filter((chat) => !workspace.isDraft(chat.id) && chat.title.includes(filter.trim()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const history = (
    <div>
      {searching ? (
        <div className="qx-search xb-sidebar-search">
          <MagnifyingGlassIcon aria-hidden="true" />
          <input
            autoFocus
            aria-label="搜索对话"
            placeholder="搜索对话"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onBlur={() => {
              if (!filter) {
                setSearching(false)
              }
            }}
          />
        </div>
      ) : null}
      {(
        [
          [true, '置顶'],
          [false, '最近'],
        ] as const
      ).map(([pinned, label]) => {
        const list = shown.filter((chat) => chat.pinned === pinned)
        if (!list.length) {
          return null
        }
        return (
          <section key={label} className="xb-history-group">
            <h2 className="qx-group-label">{label}</h2>
            {list.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className="qx-item application-history__conversation xb-history-item"
                aria-current={view.kind === 'chat' && view.id === chat.id ? 'page' : undefined}
                title={chat.title}
                onClick={() => go({ kind: 'chat', id: chat.id })}
              >
                <span>{chat.title}</span>
                {chat.turns.some((turn) => turn.streaming || turn.task?.status === 'running') ? (
                  <CircleNotchIcon className="cv-spin xb-history-item__state" aria-label="进行中" />
                ) : chat.imported ? (
                  <ClockCounterClockwiseIcon
                    className="xb-history-item__state"
                    aria-label="从历史导入"
                  />
                ) : null}
              </button>
            ))}
          </section>
        )
      })}
      {!shown.length && filter ? (
        <p className="qx-meta application-history__hint">没有找到「{filter}」</p>
      ) : null}
    </div>
  )

  if (!user) {
    return (
      <ApplicationFrame
        collapsed={false}
        drawerOpen={false}
        narrow={narrow}
        immersive
        workspace={false}
        wide
        sidebarRef={sidebarRef}
        brand={null}
        toggle={null}
        newConversation={null}
        navigation={null}
        secondaryNavigation={null}
        history={null}
        account={null}
        notifications={null}
        mobileHeader={null}
        notice={null}
        skipLabel="跳到主要内容"
        sidebarLabel="Unigate Chat 功能栏"
        dismissLabel="关闭菜单"
        onDismiss={() => {}}
      >
        <div className="application-content">
          <LoginPage
            loading={user === undefined}
            error={error}
            onSignIn={() => location.assign('/api/auth/login')}
          />
        </div>
      </ApplicationFrame>
    )
  }

  return (
    <>
      <ApplicationFrame
        collapsed={collapsed && !narrow}
        drawerOpen={drawer}
        narrow={narrow}
        immersive={false}
        workspace
        wide
        sidebarRef={sidebarRef}
        skipLabel="跳到主要内容"
        sidebarLabel="Unigate Chat 功能栏"
        dismissLabel="关闭菜单"
        onDismiss={() => setDrawer(false)}
        notice={
          error ? (
            <p role="alert" className="qx-meta xb-provenance">
              {error}
            </p>
          ) : null
        }
        brand={
          <a
            className="application-brand xb-brand-link"
            href="#"
            onClick={(event) => {
              event.preventDefault()
              go({ kind: 'agent' })
            }}
          >
            <BrandName />
          </a>
        }
        toggle={
          <button
            className="qx-btn qx-btn--ghost qx-btn--icon"
            type="button"
            aria-label={narrow ? '关闭菜单' : collapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => (narrow ? setDrawer(false) : setCollapsed((value) => !value))}
          >
            {narrow ? <NavIcon name="close" /> : <NavIcon name="sidebar" />}
          </button>
        }
        newConversation={
          <button type="button" className="qx-item" title="新对话" onClick={newChat}>
            <NavIcon name="compose" />
            <span className="application-navigation__label">新对话</span>
          </button>
        }
        navigation={
          <nav className="application-navigation" aria-label="主导航">
            <button
              type="button"
              className="qx-item xb-agent-item"
              title={agent.name}
              aria-current={view.kind === 'agent' ? 'page' : undefined}
              onClick={() => go({ kind: 'agent' })}
            >
              <span className="application-nav-icon xb-agent-item__mark">
                <OctoMark size={20} />
              </span>
              <span className="application-navigation__label">{agent.name}</span>
            </button>
            <button
              type="button"
              className="qx-item"
              title="导入 DeepSeek 记录"
              onClick={openImport}
            >
              <NavIcon name="import" />
              <span className="application-navigation__label">导入 DeepSeek 记录</span>
            </button>
            <button
              type="button"
              className="qx-item"
              onClick={() => setSearching((value) => !value)}
            >
              <MagnifyingGlassIcon className="application-nav-icon" />
              <span className="application-navigation__label">搜索对话</span>
            </button>
          </nav>
        }
        secondaryNavigation={null}
        history={history}
        account={
          <div className="application-account">
            <div className="application-account-menu">
              <button
                type="button"
                className="qx-item application-account__identity"
                onClick={() => openSettings('account')}
              >
                <span className="qx-avatar xb-user-avatar" aria-hidden="true">
                  {Array.from(user.name)[0]}
                </span>
                <span className="application-account__name xb-account">
                  <span>{user.name}</span>
                  <span className="qx-meta">
                    {billing ? `余额 ¥${billing.balance.toFixed(2)}` : 'UniGate'}
                  </span>
                </span>
              </button>
            </div>
            <button
              type="button"
              className="qx-btn qx-btn--ghost qx-btn--icon"
              aria-label="设置"
              onClick={() => openSettings('agent')}
            >
              <GearSixIcon />
            </button>
          </div>
        }
        notifications={null}
        mobileHeader={
          <>
            <button
              className="qx-btn qx-btn--ghost qx-btn--icon"
              type="button"
              aria-label="打开菜单"
              aria-expanded={drawer}
              aria-controls="application-sidebar"
              onClick={() => setDrawer(true)}
            >
              <NavIcon name="menu" />
            </button>
            <a
              className="application-brand"
              href="#"
              onClick={(event) => {
                event.preventDefault()
                go({ kind: 'agent' })
              }}
            >
              <BrandName />
            </a>
            <button
              data-mobile-new
              className="qx-btn qx-btn--ghost qx-btn--icon"
              type="button"
              aria-label="新对话"
              onClick={newChat}
            >
              <NavIcon name="compose" />
            </button>
          </>
        }
      >
        <div className="application-content">
          {view.kind === 'agent' ? (
            <AgentPage
              items={[]}
              jobs={[]}
              pending={false}
              mood="idle"
              onSend={() => {}}
              enabled={false}
              onOpenSettings={() => openSettings('agent')}
            />
          ) : current ? (
            <ChatPage
              key={current.id}
              conversation={current}
              balance={billing?.balance}
              models={models}
              onSend={(text, options) => {
                void workspace.send(current, text, current.model || defaultModel, options)
              }}
              onModelChange={(model) => {
                void workspace
                  .edit(current, { model })
                  .catch((failure) => setError(errorText(failure)))
              }}
              onRename={(title) => {
                void workspace
                  .edit(current, { title })
                  .catch((failure) => setError(errorText(failure)))
              }}
              onPin={() => {
                void workspace
                  .edit(current, { pinned: !current.pinned })
                  .catch((failure) => setError(errorText(failure)))
              }}
              onDelete={() => {
                void workspace.remove(current.id).then(
                  () => go({ kind: 'agent' }),
                  (failure) => setError(errorText(failure))
                )
              }}
              onStop={() => workspace.stop(current.id)}
              onOpenAgent={() => go({ kind: 'agent' })}
              onOpenImport={openImport}
            />
          ) : null}
        </div>
      </ApplicationFrame>
      {settings ? (
        <SettingsDialog
          tab={settings}
          onTab={openSettings}
          onClose={() => setSettings(null)}
          scheme={scheme}
          onScheme={setScheme}
          user={user}
          billing={billing}
          onBillingPage={refreshBilling}
          onSignOut={() => {
            void signOut().catch((failure) => setError(errorText(failure)))
          }}
        />
      ) : null}
      {importing ? (
        <ImportDialog
          userId={user.id}
          model={defaultModel}
          onClose={() => setImporting(false)}
          onImported={imported}
        />
      ) : null}
    </>
  )
}
