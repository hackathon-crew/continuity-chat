import {
  ArrowClockwiseIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  GlobeIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PresentationChartIcon,
  PushPinIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { useStreamPacer } from '../../vendor/everplain/app/agent/useStreamPacer'
import { ConversationActivity } from '../../vendor/everplain/app/conversation-view/ConversationActivity'
import { ConversationComposer } from '../../vendor/everplain/app/conversation-view/ConversationComposer'
import { ConversationLayout } from '../../vendor/everplain/app/conversation-view/ConversationLayout'
import { ConversationThinking } from '../../vendor/everplain/app/conversation-view/ConversationThinking'
import { flyBubble, takeLaunch } from '../../vendor/everplain/app/conversation-view/sendFlight'
import '../../vendor/everplain/app/conversation-view/conversation-view.css'
import type { Conversation, Model, Turn } from '../../../contract/types'
import { displayDate } from '../../shared/displayDate'
import { Markdown, ModelPicker, OctoMark, Popover } from '../../shared/ui/parts'
import { FileCard } from '../agent/AgentPage'
import type { SendOptions } from './useConversations'

type ChatPageProps = {
  conversation: Conversation
  balance?: number
  models: Model[]
  agentName: string
  searchEnabled: boolean
  onSend: (text: string, options: SendOptions) => void
  onRename: (title: string) => void
  onPin: () => void
  onDelete: () => void
  onStop: () => void
  onModelChange: (id: string) => void
  onOpenAgent: (taskId?: string) => void
  onOpenImport: () => void
}

function TurnView({
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

function ChatActions({
  conversation,
  onRename,
  onPin,
  onDelete,
}: Pick<ChatPageProps, 'conversation' | 'onRename' | 'onPin' | 'onDelete'>) {
  const { title, pinned, turns } = conversation
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'rename' | 'delete'>()
  const [name, setName] = useState(title)
  function download() {
    const content = [`# ${title}`, ...turns.flatMap((turn) => [turn.question, turn.answer])].join(
      '\n\n'
    )
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${title}.md`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setOpen(false)
  }
  function dismiss() {
    setOpen(false)
    setMode(undefined)
  }
  return (
    <div className="cv-actions">
      <button
        className="qx-btn qx-btn--ghost qx-btn--icon"
        type="button"
        aria-label={`${title}的更多操作`}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            dismiss()
          } else {
            setOpen(true)
          }
        }}
      >
        <DotsThreeIcon weight="bold" />
      </button>
      <Popover open={open} onClose={dismiss} className="cv-actions__menu" label="对话操作">
        {mode === 'rename' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onRename(name)
              dismiss()
            }}
          >
            <input
              className="qx-input"
              aria-label="新标题"
              autoFocus
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className="qx-btn qx-btn--primary" type="submit" disabled={!name.trim()}>
              保存
            </button>
          </form>
        ) : mode === 'delete' ? (
          <>
            <p className="qx-meta">删除「{title}」？</p>
            <button className="qx-item xb-danger-item" type="button" onClick={onDelete}>
              确认删除
            </button>
            <button className="qx-item" type="button" onClick={() => setMode(undefined)}>
              取消
            </button>
          </>
        ) : (
          <>
            <button
              className="qx-item"
              type="button"
              onClick={() => {
                onPin()
                dismiss()
              }}
            >
              <PushPinIcon />
              {pinned ? '取消置顶' : '置顶'}
            </button>
            <button
              className="qx-item"
              type="button"
              onClick={() => {
                setName(title)
                setMode('rename')
              }}
            >
              <PencilSimpleIcon />
              重命名
            </button>
            <button className="qx-item" type="button" onClick={download}>
              <DownloadSimpleIcon />
              导出为 Markdown
            </button>
            <div className="qx-menu__divider" />
            <button
              className="qx-item xb-danger-item"
              type="button"
              onClick={() => setMode('delete')}
            >
              <TrashIcon />
              删除对话
            </button>
          </>
        )}
      </Popover>
    </div>
  )
}

export function ChatPage({
  conversation,
  balance,
  models,
  agentName,
  searchEnabled,
  onSend,
  onModelChange,
  onOpenAgent,
  onOpenImport,
  onRename,
  onPin,
  onDelete,
  onStop,
}: ChatPageProps) {
  const [value, setValue] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [search, setSearch] = useState(false)
  const [handoff, setHandoff] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const empty = conversation.turns.length === 0
  const streaming = conversation.turns.some((turn) => turn.streaming)
  const [files, setFiles] = useState<File[]>([])
  const lastAnswerLength = conversation.turns.at(-1)?.answer.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [conversation.turns.length, lastAnswerLength])
  useEffect(() => {
    setValue('')
    setHandoff(false)
  }, [conversation.id])

  function send() {
    const text = value.trim()
    if (!text || streaming || !models.length) {
      return
    }
    onSend(text, { search, handoff, files })
    setFiles([])
    setValue('')
    setHandoff(false)
  }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const tools = (
    <div className="cv-tool-attachments">
      <button
        className="qx-btn"
        type="button"
        role="menuitem"
        onClick={() => {
          setToolsOpen(false)
          fileRef.current?.click()
        }}
      >
        <PaperclipIcon aria-hidden="true" />
        上传文件
      </button>
      <button
        className="qx-btn"
        type="button"
        role="menuitemcheckbox"
        aria-checked={search}
        disabled={!searchEnabled}
        onClick={() => {
          setSearch((value) => !value)
          setToolsOpen(false)
        }}
      >
        <GlobeIcon aria-hidden="true" />
        联网搜索{search ? <CheckIcon className="xb-menu-check" aria-hidden="true" /> : null}
      </button>
      <button
        className="qx-btn"
        type="button"
        role="menuitem"
        onClick={() => {
          setValue((current) => current || '把上面的内容做成一份演示文稿')
          setHandoff(true)
          setToolsOpen(false)
          inputRef.current?.focus()
        }}
      >
        <PresentationChartIcon aria-hidden="true" />
        生成演示文稿
      </button>
      <button
        className="qx-btn"
        type="button"
        role="menuitemcheckbox"
        aria-checked={handoff}
        onClick={() => {
          setHandoff((value) => !value)
          setToolsOpen(false)
          inputRef.current?.focus()
        }}
      >
        <OctoMark size={18} />
        交给{agentName}去做
        {handoff ? <CheckIcon className="xb-menu-check" aria-hidden="true" /> : null}
      </button>
    </div>
  )

  const composer = (
    <>
      <ConversationComposer
        scopeKey={conversation.id}
        mode="standard"
        value={value}
        label="给 Unigate Chat 发消息"
        placeholder={empty ? '问点什么，或者接着聊' : '继续聊'}
        maxLength={8000}
        busy={false}
        canSend={Boolean(value.trim()) && !streaming && models.length > 0}
        canStop={streaming}
        uploading={false}
        toolsOpen={toolsOpen}
        inputRef={inputRef}
        toolsRef={toolsRef}
        toolsButtonRef={toolsButtonRef}
        fileRef={fileRef}
        accept=".txt,.md,.png,.jpg,.jpeg,.webp,.gif"
        attachments={files.map((file, index) => ({
          id: String(index),
          title: file.name,
          status: '就绪',
          removable: true,
        }))}
        tools={tools}
        context={
          handoff ? (
            <div className="xb-composer-chip">
              <OctoMark size={18} />
              <span>这一条交给{agentName}，它做好会在自己那里告诉你</span>
              <button
                type="button"
                className="qx-btn qx-btn--ghost qx-btn--icon"
                aria-label="取消交给 Uni "
                onClick={() => setHandoff(false)}
              >
                <XIcon />
              </button>
            </div>
          ) : undefined
        }
        modelSelector={
          <div className="xb-composer-meta">
            {search ? (
              <button
                type="button"
                className="qx-tag xb-search-tag"
                aria-pressed="true"
                aria-label="关闭联网搜索"
                onClick={() => setSearch(false)}
              >
                <GlobeIcon aria-hidden="true" />
                联网
              </button>
            ) : null}
            <ModelPicker
              value={conversation.model}
              onChange={onModelChange}
              balance={balance}
              models={models}
            />
          </div>
        }
        onChange={setValue}
        onKeyDown={keyDown}
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
        onStop={onStop}
        onToggleTools={() => setToolsOpen((value) => !value)}
        onUpload={(added) => setFiles((current) => [...current, ...added].slice(0, 8))}
        onRemoveAttachment={(id) =>
          setFiles((current) => current.filter((_, index) => String(index) !== id))
        }
      />
      {empty ? (
        <div className="xb-suggestions">
          <button type="button" className="qx-item" onClick={onOpenImport}>
            <ClockCounterClockwiseIcon weight="bold" aria-hidden="true" />
            导入 DeepSeek 记录，接着原来的对话聊
          </button>
          <button
            type="button"
            className="qx-item"
            onClick={() => {
              setValue('帮我写一封请假邮件，明天上午去医院')
              inputRef.current?.focus()
            }}
          >
            <EnvelopeSimpleIcon weight="bold" aria-hidden="true" />
            写一封请假邮件
          </button>
          <button
            type="button"
            className="qx-item"
            onClick={() => {
              setValue('今天有点累，陪我聊一会儿')
              inputRef.current?.focus()
            }}
          >
            <ChatCircleIcon weight="bold" aria-hidden="true" />
            陪我聊一会儿
          </button>
        </div>
      ) : null}
    </>
  )

  const thread = (
    <div className="cv-thread">
      {conversation.imported ? (
        <p className="cv-turn__provenance xb-provenance">
          <ClockCounterClockwiseIcon />
          {conversation.imported.source === 'legacy' ? '从旧版导入' : '从 DeepSeek 导入'} ·{' '}
          {conversation.imported.messages} 条消息 · 最后一次{' '}
          {displayDate(conversation.imported.last)}
          <span>上下文已经接上，往下聊就行</span>
        </p>
      ) : null}
      {conversation.turns.map((turn, index) => (
        <TurnView
          key={turn.id}
          turn={turn}
          conversationId={conversation.id}
          onOpenAgent={onOpenAgent}
          agentName={agentName}
          onRegenerate={
            !turn.imported && !turn.task && !streaming && index === conversation.turns.length - 1
              ? () => onSend(turn.question, { search, handoff: false, replaceId: turn.id })
              : undefined
          }
        />
      ))}
      <div ref={endRef} />
    </div>
  )

  return (
    <ConversationLayout
      embedded={false}
      empty={empty}
      research={false}
      runtimeMode="standard"
      sourceOpen={false}
      title={conversation.title}
      label={conversation.title}
      modes={<div className="cv-mode-switch" />}
      actions={
        empty ? null : (
          <ChatActions
            conversation={conversation}
            onRename={onRename}
            onPin={onPin}
            onDelete={onDelete}
          />
        )
      }
      pet={null}
      prompt="今天想聊点什么？"
      thread={thread}
      composer={composer}
    />
  )
}
