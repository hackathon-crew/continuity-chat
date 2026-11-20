import { useEffect, useRef, useState } from 'react'
import type { ConversationSummary } from '../../contract/types'
import { AppSidebar, type View } from './AppSidebar'
import { AgentPage } from '../modules/agent/AgentPage'
import { useAgent } from '../modules/agent/useAgent'
import { useConversations } from '../modules/chat/useConversations'
import { ImportDialog } from '../modules/import/ImportDialog'
import { ChatWorkspace } from './ChatWorkspace'
import { SessionProvider, errorText, useSession } from './SessionContext'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import { useNarrow } from './useNarrow'
import { useTheme } from './useTheme'
import './app.css'

export function App() {
  return (
    <SessionProvider>
      <Workspace />
    </SessionProvider>
  )
}

function Workspace() {
  const { user, billing, models, setError, refreshBilling, loadSession, signOut } = useSession()
  const narrow = useNarrow()
  const { scheme, setScheme } = useTheme()
  const [drawer, setDrawer] = useState(false)
  const [view, setView] = useState<View>({ kind: 'agent' })
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [importing, setImporting] = useState(false)
  const [jobsSignal, setJobsSignal] = useState(0)
  const workspace = useConversations(setError, refreshBilling)
  const loadList = useRef(workspace.loadList)
  const uni = useAgent(user?.id, setError, refreshBilling)
  const agentName = uni.profile.name

  useEffect(() => loadSession(loadList.current), [loadSession])

  const states = new Map(
    uni.jobs.map((job) => [job.id, job.state === 'scheduled' ? ('running' as const) : job.state])
  )
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

  function openImport() {
    setImporting(true)
    setDrawer(false)
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

  function openSettings(tab: SettingsTab) {
    setDrawer(false)
    setSettings(tab)
    if (tab === 'account') {
      void refreshBilling()
    }
  }

  function openAgent(taskId?: string) {
    const job = uni.jobs.find((item) => item.id === taskId)
    if (job?.state === 'waiting') {
      uni.setSelected(job)
    }
    setJobsSignal((value) => value + 1)
    go({ kind: 'agent' })
  }

  return (
    <>
      <AppSidebar
        view={view}
        narrow={narrow}
        drawer={drawer}
        setDrawer={setDrawer}
        chats={workspace.chats}
        isDraft={workspace.isDraft}
        states={states}
        agentName={agentName}
        go={go}
        newChat={() => go({ kind: 'chat', id: workspace.startDraft(defaultModel) })}
        openImport={openImport}
        openSettings={openSettings}
      >
        {view.kind === 'agent' ? (
          <AgentPage
            items={uni.items}
            jobs={uni.jobs}
            pending={uni.pending}
            mood={uni.mood}
            name={agentName}
            onSend={(text, files) => {
              void uni.send(text, defaultModel, files)
            }}
            enabled={Boolean(defaultModel)}
            onOpenSettings={() => openSettings('agent')}
            openJobs={jobsSignal}
            selected={uni.selected}
            onSelectTask={uni.setSelected}
            onReminder={(id, enabled) => {
              void uni.toggleReminder(id, enabled).catch((failure) => setError(errorText(failure)))
            }}
            onRetry={(task) => {
              void uni.send('请继续这项任务。', defaultModel, [], task)
            }}
          />
        ) : current ? (
          <ChatWorkspace
            key={current.id}
            conversation={current}
            workspace={workspace}
            states={states}
            agentName={agentName}
            searchEnabled={uni.tools.some((tool) => tool.id === 'web_search' && tool.on)}
            defaultModel={defaultModel}
            onDeleted={() => go({ kind: 'agent' })}
            onOpenAgent={openAgent}
            onOpenImport={openImport}
          />
        ) : null}
      </AppSidebar>
      {user && settings ? (
        <SettingsDialog
          tab={settings}
          onTab={openSettings}
          onClose={() => setSettings(null)}
          scheme={scheme}
          onScheme={setScheme}
          user={user}
          billing={billing}
          onBillingPage={refreshBilling}
          uni={uni}
          onSignOut={() => {
            void signOut(workspace.reset).then(
              () => {
                setSettings(null)
                setView({ kind: 'agent' })
              },
              (failure) => setError(errorText(failure))
            )
          }}
        />
      ) : null}
      {user && importing ? (
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
