import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { setApiKey, useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  retrySaveSessions,
  selectSession,
  switchChatOwner,
  useChatStore,
} from '../services/chat/store.js'
import { api, type PlatformUser } from '../services/platform.js'
import { startProactiveDelivery } from '../services/proactive.js'
import { loadProvider } from '../services/provider.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { AuthScreen } from '../components/platform/AuthScreen.js'
import type { WorkspaceView } from '../components/platform/workspaceView.js'
import { AccountPage } from '../components/platform/AccountPage.js'
import { CompanionStudio } from '../components/platform/CompanionStudio.js'
import { AgentWorkspace } from '../components/platform/AgentWorkspace.js'
import { TasksPage } from '../components/platform/TasksPage.js'
import { MigrationDialog, openMigration } from '../components/platform/MigrationDialog.js'
import platformStyles from '../components/platform/Platform.module.css'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const [user, setUser] = useState<PlatformUser | null | undefined>(undefined)
  const [view, setView] = useState<WorkspaceView>('chat')
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    void api<{ user: PlatformUser | null }>('/api/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    if (!user) {
      return
    }
    const currentKey = useSettings.getState().apiKey
    void loadProvider(true)
    setApiKey(
      user.keyMode === 'platform'
        ? 'platform'
        : currentKey && currentKey !== 'platform'
          ? currentKey
          : 'stored'
    )
    let stop: (() => void) | undefined
    let cancelled = false
    void switchChatOwner(user.id).then(() => {
      if (cancelled) {
        return
      }
      if (
        useChatStore.getState().sessions.length === 0 &&
        !localStorage.getItem(`continuity:onboarded:${user.id}`)
      ) {
        openMigration()
      }
      stop = startProactiveDelivery()
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [user])

  useEffect(() => {
    const openAccount = () => setView('account')
    window.addEventListener('continuity:open-account', openAccount)
    return () => window.removeEventListener('continuity:open-account', openAccount)
  }, [])
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])
  useEffect(closeSearchPanel, [activeId])
  useEffect(stopReadAloud, [activeId])
  useEffect(closeMobileSider, [activeId, isMobile])

  if (user === undefined) {
    return <div className={platformStyles.loadingPage}>正在恢复你的空间…</div>
  }
  if (user === null) {
    return (
      <>
        <AuthScreen onAuthenticated={setUser} />
        <Toast />
      </>
    )
  }

  const chatContent = (
    <div className={styles.content}>
      {siderCollapsed ? <CollapsedSider onView={setView} /> : null}
      {!ready || (activeId !== null && !session) ? (
        <div className={styles.loadingView}>
          {isMobile ? <MobileHeader /> : null}
          <div className={styles.loadingState} role="status" aria-live="polite">
            <span>
              {(!ready ? initError : sessionLoadError)
                ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                : t('sessionLoading')}
            </span>
            {(!ready ? initError : sessionLoadError) ? (
              <Button
                variant="outlined"
                size="m"
                onClick={() => {
                  if (user) {
                    void switchChatOwner(user.id)
                  }
                  if (ready && activeId !== null) {
                    selectSession(activeId)
                  }
                }}
              >
                {t('retry')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : session ? (
        <SessionView session={session} streaming={streaming} siderCollapsed={siderCollapsed} />
      ) : (
        <Welcome />
      )}
    </div>
  )

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? (
          <MobileSider user={user} view={view} onView={setView} />
        ) : siderCollapsed ? null : (
          <Sider user={user} view={view} onView={setView} />
        )}
        <main className={styles.main}>
          {view === 'chat' && saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          {view === 'chat' ? (
            chatContent
          ) : (
            <>
              {siderCollapsed ? <CollapsedSider onView={setView} /> : null}
              {isMobile && view !== 'agent' ? <MobileHeader /> : null}
              <div className={`${styles.content} ${styles.platformContent}`}>
                {view === 'studio' ? <CompanionStudio /> : null}
                {view === 'agent' ? <AgentWorkspace onOpenTasks={() => setView('tasks')} /> : null}
                {view === 'tasks' ? <TasksPage /> : null}
                {view === 'account' ? (
                  <AccountPage
                    user={user}
                    onUser={setUser}
                    onLogout={() => {
                      setUser(null)
                      setView('chat')
                    }}
                  />
                ) : null}
              </div>
            </>
          )}
        </main>
        {view === 'chat' ? <SearchPanel /> : null}
      </div>
      <SettingsDialog />
      <MigrationDialog userId={user.id} />
      <Toast />
    </>
  )
}
