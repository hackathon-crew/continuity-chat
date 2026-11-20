import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
} from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Turn } from '../../../contract/types'
import { OctoMark } from '../../shared/ui/Brand'
import { FileCard } from '../../shared/ui/FileCard'
import { Markdown } from '../../shared/ui/Markdown'
import { useStreamPacer } from '../../vendor/everplain/app/agent/useStreamPacer'
import { ConversationActivity } from '../../vendor/everplain/app/conversation-view/ConversationActivity'
import { ConversationThinking } from '../../vendor/everplain/app/conversation-view/ConversationThinking'
import { flyBubble, takeLaunch } from '../../vendor/everplain/app/conversation-view/sendFlight'

export function TurnView({
  turn,
  conversationId,
  onOpenAgent,
  onRegenerate,
  agentName,
}: {
  turn: Turn
  conversationId: string
  onOpenAgent: (taskId?: string) => void
  onRegenerate?: () => void
  agentName: string
}) {
  const bubble = useRef<HTMLDivElement>(null)
  const launchedWhileStreaming = useRef(turn.streaming)
  const pacer = useStreamPacer(turn.answer, Boolean(turn.streaming))
  const [copied, setCopied] = useState(false)
  useLayoutEffect(() => {
    const node = bubble.current
    if (!node || !launchedWhileStreaming.current) {
      return
    }
    const from = takeLaunch(turn.question)
    if (!from) {
      return
    }
    node.setAttribute('data-awaiting-flight', '')
    let cancel: (() => void) | undefined
    const raf = requestAnimationFrame(() => {
      cancel = flyBubble(node, from)
    })
    return () => {
      cancelAnimationFrame(raf)
      cancel?.()
      node.removeAttribute('data-awaiting-flight')
    }
  }, [turn.question, turn.id])
  const steps = turn.steps ?? []
  const done = !turn.streaming && Boolean(turn.answer || turn.error)
  return (
    <article
      style={{ '--agent-color': 'var(--qx-color-data-blue)' } as CSSProperties}
      className="cv-turn"
      data-streaming={turn.streaming || undefined}
    >
      <div className="cv-turn__question">
        <div className="cv-turn__question-content">
          <div ref={bubble} className="qx-bubble">
            {turn.question}
            {turn.files?.map((file) => (
              <div key={file.id}>
                {file.available ? (
                  <a
                    download={file.name}
                    href={`/api/conversations/${conversationId}/files/${encodeURIComponent(file.id)}`}
                  >
                    {file.name}
                  </a>
                ) : (
                  <span>{file.name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cv-turn__answer">
        <div className="cv-turn__body">
          <ConversationThinking turn={turn} />
          <ConversationActivity steps={steps} />
          {turn.reasoning ? (
            <details className="qx-meta">
              <summary>思考过程</summary>
              <Markdown text={turn.reasoning} />
            </details>
          ) : null}
          {turn.artifacts?.map((artifact) => (
            <FileCard key={artifact.fileId} {...artifact} />
          ))}
          {turn.error ? (
            <p role="alert" className="qx-meta">
              {turn.error}
            </p>
          ) : null}
          {pacer.visible ? (
            <div className="qx-prose cv-turn__prose">
              <Markdown text={pacer.visible} reveal={pacer} />
            </div>
          ) : null}
          {turn.task && done ? (
            <button type="button" className="xb-task" onClick={() => onOpenAgent(turn.task?.id)}>
              <span className="xb-task__state" data-state={turn.task.status}>
                {turn.task.status === 'running' ? (
                  <CircleNotchIcon className="cv-spin" aria-hidden="true" />
                ) : (
                  <CheckCircleIcon aria-hidden="true" />
                )}
              </span>
              <span className="xb-task__text">
                <strong>{turn.task.title}</strong>
                <span className="qx-meta">
                  {turn.task.status === 'running'
                    ? `${agentName} 正在做，做好会在它那里告诉你`
                    : turn.task.status === 'waiting'
                      ? `${agentName} 在等你回复`
                      : turn.task.status === 'failed'
                        ? `去 ${agentName} 的任务页继续`
                        : `已完成，去 ${agentName} 那里查看`}
                </span>
              </span>
              <OctoMark size={24} />
            </button>
          ) : null}
          {done ? (
            <div className="cv-turn__actions">
              <button
                className="qx-btn qx-btn--ghost qx-btn--icon"
                type="button"
                aria-label={copied ? '已复制' : '复制回答'}
                title={copied ? '已复制' : '复制回答'}
                onClick={() => {
                  void navigator.clipboard.writeText(turn.answer).then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1600)
                  })
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
              {onRegenerate ? (
                <button
                  className="qx-btn qx-btn--ghost qx-btn--icon"
                  type="button"
                  aria-label="重新生成"
                  title="重新生成"
                  onClick={onRegenerate}
                >
                  <ArrowClockwiseIcon />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
