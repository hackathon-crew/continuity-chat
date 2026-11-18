import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconDataOutline16,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  IconThinkOutline14,
  IconUploadOutline14,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import type { PlatformUser } from '../../services/platform.js'
import type { WorkspaceView } from '../platform/workspaceView.js'
import { AgentOrb } from '../platform/AgentOrb.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { openMigration } from '../platform/MigrationDialog.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

type SiderProps = {
  mobile?: boolean
  user: PlatformUser
  view: WorkspaceView
  onView: (view: WorkspaceView) => void
}

export const Sider = ({ mobile = false, user, view, onView }: SiderProps) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const changeView = (next: WorkspaceView) => {
    onView(next)
    if (mobile) {
      closeMobileSider()
    }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <button className={styles.brand} onClick={() => changeView('chat')}>
          续伴 <span>Continuity</span>
        </button>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        className={styles.newChat}
        onClick={() => {
          newChat()
          changeView('chat')
        }}
      >
        <NewChatIcon />
        <span>开启新对话</span>
      </button>
      <button
        className={clsx(styles.agentEntry, view === 'agent' && styles.agentEntryActive)}
        onClick={() => changeView('agent')}
      >
        <AgentOrb size="small" active={view === 'agent'} />
        <span className={styles.agentText}>
          <strong>Personal Agent</strong>
          <small>长期目标与独立任务</small>
        </span>
        <span className={styles.onlineDot} />
      </button>
      <button
        className={styles.migrationButton}
        onClick={() => {
          changeView('chat')
          openMigration()
        }}
      >
        <IconUploadOutline14 /> 接回 DeepSeek 对话
      </button>
      <div className={styles.listWrap}>
        <div className={styles.conversationLabel}>对话</div>
        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={view === 'chat' && session.id === activeId}
                  onDelete={() => setDeleting(session)}
                  onSelect={() => onView('chat')}
                />
              ))}
            </div>
          ))}
          {sessions.length === 0 ? (
            <div className={styles.emptyChats}>导入一段历史，或开始新的对话。</div>
          ) : null}
        </div>
      </div>
      <div className={styles.bottom}>
        <button
          className={clsx(styles.navRow, view === 'studio' && styles.navRowActive)}
          onClick={() => changeView('studio')}
        >
          <IconDataOutline16 />
          <span>伙伴与能力</span>
        </button>
        <button
          className={clsx(styles.navRow, view === 'tasks' && styles.navRowActive)}
          onClick={() => changeView('tasks')}
        >
          <IconThinkOutline14 />
          <span>自动化</span>
        </button>
        <div className={styles.accountRow}>
          <button className={styles.accountButton} onClick={() => changeView('account')}>
            <span className={styles.avatar}>{user.name.slice(0, 1).toUpperCase()}</span>
            <span className={styles.accountText}>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </button>
          <IconButton
            size="m"
            icon={<IconSettingsOutline16 />}
            tooltip={t('settings')}
            onClick={() => openSettings('general')}
          />
        </div>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

export const MobileSider = (props: Omit<SiderProps, 'mobile'>) => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider {...props} mobile />
      </div>
    </>
  )
}
