import { BellSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { AgentItem } from '../../../contract/types'
import { FileCard } from '../../shared/ui/FileCard'
import { Markdown } from '../../shared/ui/Markdown'
import { useStreamPacer } from '../../vendor/everplain/app/agent/useStreamPacer'
import { ConversationActivity } from '../../vendor/everplain/app/conversation-view/ConversationActivity'
import { ConversationThinking } from '../../vendor/everplain/app/conversation-view/ConversationThinking'
import { flyBubble, takeLaunch } from '../../vendor/everplain/app/conversation-view/sendFlight'
import { shortTime } from './agentTime'

type ReminderToggle = (id: string, enabled: boolean) => void

function AgentBubble({ text, streaming }: { text: string; streaming?: boolean }) {
  const pacer = useStreamPacer(text, Boolean(streaming))
  return (
    <div className="xb-bubble">
      <Markdown text={pacer.visible} reveal={pacer} />
    </div>
  )
}

function UserBubble({ text, live }: { text: string; live?: boolean }) {
  const bubble = useRef<HTMLDivElement>(null)
  const launched = useRef(live)
  useLayoutEffect(() => {
    const node = bubble.current
    if (!node || !launched.current) {
      return
    }
    const from = takeLaunch(text)
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
  }, [text])
  return (
    <div className="cv-turn__question">
      <div ref={bubble} className="qx-bubble xb-bubble--user">
        {text}
      </div>
    </div>
  )
}

function Reminder({
  item,
  onToggle,
}: {
  item: Extract<AgentItem, { kind: 'reminder' }>
  onToggle: ReminderToggle
}) {
  const label = { once: '一次', daily: '每天', weekly: '每周' }[item.rule]
  return (
    <div className="xb-file">
      <BellSimpleIcon className="xb-file__icon" aria-hidden="true" />
      <span className="xb-file__text">
        <strong>{item.title}</strong>
        <span className="qx-meta">
          {label} · {shortTime.format(new Date(item.at))}
        </span>
      </span>
      <button
        type="button"
        className="qx-switch"
        role="switch"
        aria-checked={item.enabled && item.active}
        disabled={!item.active}
        aria-label={item.title}
        onClick={() => onToggle(item.reminderId, !item.enabled)}
      />
    </div>
  )
}

function Item({ item, onReminder }: { item: AgentItem; onReminder: ReminderToggle }) {
  switch (item.kind) {
    case 'time':
      return <p className="qx-meta xb-time">{item.label}</p>
    case 'user':
      return (
        <div className="xb-row" data-from="user">
          <UserBubble text={item.text} live={item.live} />
        </div>
      )
    case 'agent':
      return (
        <div className="xb-row" data-from="agent">
          <AgentBubble text={item.text} streaming={item.streaming} />
        </div>
      )
    case 'file':
      return (
        <div className="xb-row" data-from="agent">
          <FileCard name={item.name} meta={item.meta} fileId={item.fileId} />
        </div>
      )
    case 'reminder':
      return (
        <div className="xb-row" data-from="agent">
          <Reminder item={item} onToggle={onReminder} />
        </div>
      )
    case 'activity':
      return (
        <div className="xb-row xb-row--activity" data-from="agent">
          <ConversationActivity steps={item.steps} />
        </div>
      )
  }
}

export function AgentItems({
  items,
  name,
  pending,
  streaming,
  onReminder,
}: {
  items: AgentItem[]
  name: string
  pending: boolean
  streaming: boolean
  onReminder: ReminderToggle
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const lastLength = (() => {
    const last = items.at(-1)
    return last && 'text' in last ? last.text.length : 0
  })()
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [items.length, lastLength, pending])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [])

  return (
    <div
      className="xb-agent-thread"
      style={{ '--agent-color': 'var(--qx-color-data-blue)' } as CSSProperties}
    >
      {!items.length && !pending ? (
        <div className="xb-row" data-from="agent">
          <AgentBubble
            text={`你好，我是 ${name}。你可以把对话里的事交给我，也可以直接在这里说。`}
          />
        </div>
      ) : null}
      {items.map((item, index) => {
        const before = items[index - 1]?.createdAt
        const showTime =
          item.createdAt &&
          (!before || new Date(item.createdAt).toDateString() !== new Date(before).toDateString())
        return (
          <div key={item.id}>
            {showTime && item.createdAt ? (
              <p className="qx-meta xb-time">{shortTime.format(new Date(item.createdAt))}</p>
            ) : null}
            <Item item={item} onReminder={onReminder} />
          </div>
        )
      })}
      {pending && !streaming ? (
        <div className="xb-row" data-from="agent">
          <ConversationThinking
            turn={{
              id: 'typing',
              question: '',
              answer: '',
              streaming: true,
              statusText: `${name} 正在输入`,
            }}
          />
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  )
}
