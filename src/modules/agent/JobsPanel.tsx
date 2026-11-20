import { CheckCircleIcon, CircleNotchIcon, ClockIcon, XIcon } from '@phosphor-icons/react'
import type { AgentJob } from '../../../contract/types'
import { shortTime } from './agentTime'

const jobGroups = [
  ['running', '正在做'],
  ['waiting', '等你确认'],
  ['failed', '可重试'],
  ['scheduled', '定时任务'],
  ['done', '最近完成'],
] as const

export function JobsPanel({
  jobs,
  onClose,
  onContinue,
  onRetry,
}: {
  jobs: AgentJob[]
  onClose: () => void
  onContinue: (task: AgentJob) => void
  onRetry: (task: AgentJob) => void
}) {
  return (
    <div className="qx-panel cv-source-panel xb-jobs">
      <div className="cv-source-panel__head">
        <h2 className="qx-card__title">任务与提醒</h2>
        <button
          type="button"
          className="qx-btn qx-btn--ghost qx-btn--icon"
          aria-label="关闭任务与提醒"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <div className="cv-source-panel__list">
        {jobGroups.map(([state, label]) => {
          const list = jobs.filter((job) => job.state === state)
          if (!list.length) {
            return null
          }
          return (
            <section key={state}>
              <h3>
                {label}
                <span>{list.length}</span>
              </h3>
              <ul className="cv-source-panel__rows">
                {list.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      className="qx-btn qx-btn--ghost"
                      disabled={!['waiting', 'failed'].includes(job.state) || job.reminder}
                      onClick={() => (job.state === 'failed' ? onRetry(job) : onContinue(job))}
                    >
                      <span
                        className="cv-tool-state"
                        data-state={
                          job.state === 'running'
                            ? 'running'
                            : job.state === 'done'
                              ? 'completed'
                              : undefined
                        }
                      >
                        {job.state === 'running' ? (
                          <CircleNotchIcon aria-hidden="true" />
                        ) : job.state === 'done' ? (
                          <CheckCircleIcon aria-hidden="true" />
                        ) : (
                          <ClockIcon aria-hidden="true" />
                        )}
                      </span>
                      <span className="xb-job">
                        <strong>{job.title}</strong>
                        <span className="qx-meta">
                          {job.dueAt
                            ? shortTime.format(new Date(job.dueAt))
                            : job.source === 'chat'
                              ? '来自普通对话'
                              : shortTime.format(new Date(job.updatedAt))}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
