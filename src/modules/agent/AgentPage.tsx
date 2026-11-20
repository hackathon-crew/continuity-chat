import {
  BellSimpleIcon,
  FileTextIcon,
  ListChecksIcon,
  SlidersHorizontalIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { AgentItem, AgentJob } from '../../../contract/types'
// Keep the original vendor cascade when thread items are loaded from their own module.
import '../../vendor/everplain/app/ui/site-icon.css'
import { Composer } from '../../shared/ui/Composer'
import { ConversationLayout } from '../../vendor/everplain/app/conversation-view/ConversationLayout'
import { AgentItems } from './AgentItems'
import '../../vendor/everplain/app/conversation-view/conversation-view.css'
import { useComposer } from '../../shared/ui/useComposer'
import { Octopus } from '../../vendor/inkpaw/Octopus'
import type { Mood } from '../../vendor/inkpaw/inkpaw-octopus'
import { JobsPanel } from './JobsPanel'

const JOBS_CLOSE_DELAY = 160

type AgentPageProps = {
  items: AgentItem[]
  jobs: AgentJob[]
  pending: boolean
  enabled: boolean
  mood: Mood
  name: string
  onSend: (text: string, files: File[]) => void
  onReminder: (id: string, enabled: boolean) => void
  selected?: AgentJob
  onSelectTask: (task?: AgentJob) => void
  onRetry: (task: AgentJob) => void
  onOpenSettings: () => void
  openJobs?: number
}

export function AgentPage({
  items,
  jobs,
  pending,
  mood,
  onSend,
  onOpenSettings,
  openJobs,
  enabled,
  name,
  onReminder,
  selected,
  onSelectTask,
  onRetry,
}: AgentPageProps) {
  const [jobsOpen, setJobsOpen] = useState(false)
  const [jobsClosing, setJobsClosing] = useState(false)
  const streaming = items.some((item) => item.kind === 'agent' && item.streaming)
  const composer = useComposer(enabled && !pending && !streaming, onSend)
  const { setValue, closeTools, openFilePicker, focus } = composer
  useEffect(() => {
    if (openJobs) {
      setJobsOpen(true)
    }
  }, [openJobs])

  function closeJobs() {
    setJobsClosing(true)
    window.setTimeout(() => {
      setJobsOpen(false)
      setJobsClosing(false)
    }, JOBS_CLOSE_DELAY)
  }
  const running = jobs.filter((job) => job.state === 'running').length

  return (
    <div className="xb-agent-page">
      <ConversationLayout
        embedded={false}
        empty={false}
        research={false}
        runtimeMode="standard"
        sourceOpen={jobsOpen}
        sourceClosing={jobsClosing}
        title={name}
        label={`和 ${name} 的对话`}
        modes={<div className="cv-mode-switch" />}
        actions={
          <div className="xb-agent-actions">
            <button
              type="button"
              className="qx-btn qx-btn--ghost"
              aria-expanded={jobsOpen}
              aria-label="任务与提醒"
              onClick={() => (jobsOpen ? closeJobs() : setJobsOpen(true))}
            >
              <ListChecksIcon aria-hidden="true" />
              <span>任务</span>
              {running ? <span className="xb-count">{running}</span> : null}
            </button>
            <button
              type="button"
              className="qx-btn qx-btn--ghost qx-btn--icon"
              aria-label={`${name} 的设定和记忆`}
              title="设定和记忆"
              onClick={onOpenSettings}
            >
              <SlidersHorizontalIcon />
            </button>
          </div>
        }
        pet={null}
        companionBar={
          <div className="xb-agent-hero">
            <Octopus
              className="xb-agent-hero__avatar"
              size={80}
              res={40}
              mood={mood}
              label={name}
            />
            <span className="xb-agent-hero__name">{name}</span>
          </div>
        }
        prompt=""
        thread={
          <AgentItems
            items={items}
            name={name}
            pending={pending}
            streaming={streaming}
            onReminder={onReminder}
          />
        }
        source={
          <JobsPanel
            jobs={jobs}
            onClose={closeJobs}
            onContinue={(task) => {
              onSelectTask(task)
              closeJobs()
              focus()
            }}
            onRetry={onRetry}
          />
        }
        composer={
          <Composer
            composer={composer}
            scopeKey="agent"
            label={`给 ${name} 发消息`}
            placeholder={`和 ${name} 说点什么`}
            canStop={false}
            context={
              selected ? (
                <div className="xb-composer-chip">
                  <span>继续「{selected.title}」</span>
                  <button
                    className="qx-btn qx-btn--ghost qx-btn--icon"
                    type="button"
                    aria-label="另开任务"
                    onClick={() => onSelectTask(undefined)}
                  >
                    <XIcon />
                  </button>
                </div>
              ) : undefined
            }
            tools={
              <div className="cv-tool-attachments">
                <button className="qx-btn" type="button" role="menuitem" onClick={openFilePicker}>
                  <FileTextIcon aria-hidden="true" />
                  发一份文件
                </button>
                <button
                  className="qx-btn"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeTools()
                    setValue('每天晚上九点提醒我')
                    focus()
                  }}
                >
                  <BellSimpleIcon aria-hidden="true" />
                  设一个提醒
                </button>
              </div>
            }
            onStop={() => {}}
          />
        }
      />
    </div>
  )
}
