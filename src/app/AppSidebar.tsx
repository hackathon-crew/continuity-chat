import {
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react'
import { useRef, useState, type ReactNode } from 'react'
import type { ChatTask, Conversation } from '../../contract/types'
import { BrandName, OctoMark } from '../shared/ui/Brand'
import { ApplicationFrame } from '../vendor/everplain/app/application-frame/ApplicationFrame'
import '../vendor/everplain/app/application-frame/application-frame.css'
import { NavIcon } from '../vendor/everplain/app/ui/NavIcon'
import { LoginFrame } from './LoginPage'
import { useSession } from './SessionContext'
import type { SettingsTab } from './SettingsDialog'

export type View = { kind: 'agent' } | { kind: 'chat'; id: string }

type AppSidebarProps = {
  view: View
  narrow: boolean
  drawer: boolean
  setDrawer: (open: boolean) => void
  chats: Conversation[]
  isDraft: (id: string) => boolean
  states: ReadonlyMap<string, ChatTask['status']>
  agentName: string
  go: (view: View) => void
  newChat: () => void
  openImport: () => void
  openSettings: (tab: SettingsTab) => void
  children: ReactNode
}

export function AppSidebar({
  view,
  narrow,
  drawer,
  setDrawer,
  chats,
  isDraft,
  states,
  agentName,
  go,
  newChat,
  openImport,
  openSettings,
  children,
}: AppSidebarProps) {
  const { user, billing, error } = useSession()
  const [collapsed, setCollapsed] = useState(false)
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  const shown = chats
    .filter((chat) => !isDraft(chat.id) && chat.title.includes(filter.trim()))
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
                {chat.turns.some(
                  (turn) =>
                    turn.streaming ||
                    (turn.task && (states.get(turn.task.id) ?? turn.task.status) === 'running')
                ) ? (
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
      <LoginFrame
        narrow={narrow}
        sidebarRef={sidebarRef}
        loading={user === undefined}
        error={error}
      />
    )
  }

  return (
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
            title={agentName}
            aria-current={view.kind === 'agent' ? 'page' : undefined}
            onClick={() => go({ kind: 'agent' })}
          >
            <span className="application-nav-icon xb-agent-item__mark">
              <OctoMark size={20} />
            </span>
            <span className="application-navigation__label">{agentName}</span>
          </button>
          <button type="button" className="qx-item" title="导入 DeepSeek 记录" onClick={openImport}>
            <NavIcon name="import" />
            <span className="application-navigation__label">导入 DeepSeek 记录</span>
          </button>
          <button type="button" className="qx-item" onClick={() => setSearching((value) => !value)}>
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
      <div className="application-content">{children}</div>
    </ApplicationFrame>
  )
}
