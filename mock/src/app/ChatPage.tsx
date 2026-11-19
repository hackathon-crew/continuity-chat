import { ArrowClockwiseIcon, ChatCircleIcon, CheckCircleIcon, EnvelopeSimpleIcon, CheckIcon, CircleNotchIcon, ClockCounterClockwiseIcon, CopyIcon, DotsThreeIcon, DownloadSimpleIcon, GlobeIcon, PaperclipIcon, PencilSimpleIcon, PresentationChartIcon, PushPinIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useStreamPacer } from '../everplain/app/agent/useStreamPacer'
import { ConversationActivity } from '../everplain/app/conversation-view/ConversationActivity'
import { ConversationComposer } from '../everplain/app/conversation-view/ConversationComposer'
import { ConversationLayout } from '../everplain/app/conversation-view/ConversationLayout'
import { ConversationThinking } from '../everplain/app/conversation-view/ConversationThinking'
import { flyBubble, takeLaunch } from '../everplain/app/conversation-view/sendFlight'
import '../everplain/app/conversation-view/conversation-view.css'
import { agent, models, type Conversation, type Turn } from './data'
import { Markdown, ModelMark, ModelPicker, OctoMark, Popover } from './parts'

type ChatPageProps = {
  conversation: Conversation
  balance: number
  onSend: (text: string, options: { search: boolean; handoff: boolean }) => void
  onModelChange: (id: string) => void
  onOpenAgent: () => void
  onOpenImport: () => void
}

function TurnView({ turn, provider, onOpenAgent }: { turn: Turn; provider: ReturnType<typeof providerOf>; onOpenAgent: () => void }) {
  const bubble = useRef<HTMLDivElement>(null)
  const launchedWhileStreaming = useRef(turn.streaming)
  const pacer = useStreamPacer(turn.answer, Boolean(turn.streaming))
  const [copied, setCopied] = useState(false)
  useLayoutEffect(() => {
    const node = bubble.current
    if (!node || !launchedWhileStreaming.current) return
    const from = takeLaunch(turn.question)
    if (!from) return
    node.setAttribute('data-awaiting-flight', '')
    let cancel: (() => void) | undefined
    const raf = requestAnimationFrame(() => { cancel = flyBubble(node, from) })
    return () => { cancelAnimationFrame(raf); cancel?.(); node.removeAttribute('data-awaiting-flight') }
  }, [turn.question, turn.id])
  const steps = turn.steps ?? []
  const done = !turn.streaming && Boolean(turn.answer)
  return <article style={{ '--agent-color': 'var(--qx-color-data-blue)' } as CSSProperties} className="cv-turn" data-streaming={turn.streaming || undefined}>
    <div className="cv-turn__question"><div className="cv-turn__question-content"><div ref={bubble} className="qx-bubble">{turn.question}</div></div></div>
    <div className="cv-turn__answer">
      <div className="cv-turn__body">
        <ConversationThinking turn={turn} />
        <ConversationActivity steps={steps} />
        {pacer.visible ? <div className="qx-prose cv-turn__prose"><Markdown text={pacer.visible} reveal={pacer} /></div> : null}
        {turn.task && done ? <button type="button" className="xb-task" onClick={onOpenAgent}>
          <span className="xb-task__state" data-state={turn.task.status}>{turn.task.status === 'running' ? <CircleNotchIcon className="cv-spin" aria-hidden="true" /> : <CheckCircleIcon aria-hidden="true" />}</span>
          <span className="xb-task__text"><strong>{turn.task.title}</strong><span className="qx-meta">{turn.task.status === 'running' ? `${agent.name}正在做，做好会在它那里告诉你` : `已完成，去${agent.name}那里查看`}</span></span>
          <OctoMark size={24} />
        </button> : null}
        {done ? <div className="cv-turn__actions">
          <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={copied ? '已复制' : '复制回答'} title={copied ? '已复制' : '复制回答'} onClick={() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }}>{copied ? <CheckIcon /> : <CopyIcon />}</button>
          <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="重新生成" title="重新生成"><ArrowClockwiseIcon /></button>
        </div> : null}
      </div>
    </div>
  </article>
}

const providerOf = (modelId: string) => (models.find(model => model.id === modelId) ?? models[0]).provider

function ChatActions({ title }: { title: string }) {
  const [open, setOpen] = useState(false)
  return <div className="cv-actions">
    <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={`${title}的更多操作`} aria-expanded={open} onClick={() => setOpen(value => !value)}><DotsThreeIcon weight="bold" /></button>
    <Popover open={open} onClose={() => setOpen(false)} className="cv-actions__menu" label="对话操作">
      <button className="qx-item" type="button" onClick={() => setOpen(false)}><PushPinIcon />置顶</button>
      <button className="qx-item" type="button" onClick={() => setOpen(false)}><PencilSimpleIcon />重命名</button>
      <button className="qx-item" type="button" onClick={() => setOpen(false)}><DownloadSimpleIcon />导出为 Markdown</button>
      <div className="qx-menu__divider" />
      <button className="qx-item xb-danger-item" type="button" onClick={() => setOpen(false)}><TrashIcon />删除对话</button>
    </Popover>
  </div>
}

export function ChatPage({ conversation, balance, onSend, onModelChange, onOpenAgent, onOpenImport }: ChatPageProps) {
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
  const streaming = conversation.turns.some(turn => turn.streaming)
  const provider = providerOf(conversation.model)
  const lastAnswerLength = conversation.turns.at(-1)?.answer.length ?? 0
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [conversation.turns.length, lastAnswerLength])
  useEffect(() => { setValue(''); setHandoff(false) }, [conversation.id])

  function send() {
    const text = value.trim()
    if (!text || streaming) return
    onSend(text, { search, handoff })
    setValue('')
    setHandoff(false)
  }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
  }

  const tools = <div className="cv-tool-attachments">
    <button className="qx-btn" type="button" role="menuitem" onClick={() => { setToolsOpen(false); fileRef.current?.click() }}><PaperclipIcon aria-hidden="true" />上传文件</button>
    <button className="qx-btn" type="button" role="menuitemcheckbox" aria-checked={search} onClick={() => { setSearch(value => !value); setToolsOpen(false) }}><GlobeIcon aria-hidden="true" />联网搜索{search ? <CheckIcon className="xb-menu-check" aria-hidden="true" /> : null}</button>
    <button className="qx-btn" type="button" role="menuitem" onClick={() => { setValue(current => current || '把上面的内容做成一份演示文稿'); setHandoff(true); setToolsOpen(false); inputRef.current?.focus() }}><PresentationChartIcon aria-hidden="true" />生成演示文稿</button>
    <button className="qx-btn" type="button" role="menuitemcheckbox" aria-checked={handoff} onClick={() => { setHandoff(value => !value); setToolsOpen(false); inputRef.current?.focus() }}><OctoMark size={18} />交给{agent.name}去做{handoff ? <CheckIcon className="xb-menu-check" aria-hidden="true" /> : null}</button>
  </div>

  const composer = <>
    <ConversationComposer
      scopeKey={conversation.id}
      mode="standard"
      value={value}
      label="给 Unigate Chat 发消息"
      placeholder={empty ? '问点什么，或者接着聊' : '继续聊'}
      maxLength={8000}
      busy={false}
      canSend={Boolean(value.trim()) && !streaming}
      canStop={streaming}
      uploading={false}
      toolsOpen={toolsOpen}
      inputRef={inputRef}
      toolsRef={toolsRef}
      toolsButtonRef={toolsButtonRef}
      fileRef={fileRef}
      accept=".pdf,.docx,.txt,.md,.png,.jpg"
      attachments={[]}
      tools={tools}
      context={handoff ? <div className="xb-composer-chip"><OctoMark size={18} /><span>这一条交给{agent.name}，它做好会在自己那里告诉你</span><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="取消交给 Uni " onClick={() => setHandoff(false)}><XIcon /></button></div> : undefined}
      modelSelector={<div className="xb-composer-meta">
        {search ? <button type="button" className="qx-tag xb-search-tag" aria-pressed="true" aria-label="关闭联网搜索" onClick={() => setSearch(false)}><GlobeIcon aria-hidden="true" />联网</button> : null}
        <ModelPicker value={conversation.model} onChange={onModelChange} balance={balance} />
      </div>}
      onChange={setValue}
      onKeyDown={keyDown}
      onSubmit={event => { event.preventDefault(); send() }}
      onStop={() => {}}
      onToggleTools={() => setToolsOpen(value => !value)}
      onUpload={() => {}}
      onRemoveAttachment={() => {}}
    />
    {empty ? <div className="xb-suggestions">
      <button type="button" className="qx-item" onClick={onOpenImport}><ClockCounterClockwiseIcon weight="bold" aria-hidden="true" />导入 DeepSeek 记录，接着原来的对话聊</button>
      <button type="button" className="qx-item" onClick={() => { setValue('帮我写一封请假邮件，明天上午去医院'); inputRef.current?.focus() }}><EnvelopeSimpleIcon weight="bold" aria-hidden="true" />写一封请假邮件</button>
      <button type="button" className="qx-item" onClick={() => { setValue('今天有点累，陪我聊一会儿'); inputRef.current?.focus() }}><ChatCircleIcon weight="bold" aria-hidden="true" />陪我聊一会儿</button>
    </div> : null}
  </>

  const thread = <div className="cv-thread">
    {conversation.imported ? <p className="cv-turn__provenance xb-provenance"><ClockCounterClockwiseIcon />从 DeepSeek 导入 · {conversation.imported.messages} 条消息 · 最后一次 {conversation.imported.last}<span>上下文已经接上，往下聊就行</span></p> : null}
    {conversation.turns.map(turn => <TurnView key={turn.id} turn={turn} provider={provider} onOpenAgent={onOpenAgent} />)}
    <div ref={endRef} />
  </div>

  return <ConversationLayout
    embedded={false}
    empty={empty}
    research={false}
    runtimeMode="standard"
    sourceOpen={false}
    title={conversation.title}
    label={conversation.title}
    modes={<div className="cv-mode-switch" />}
    actions={empty ? null : <ChatActions title={conversation.title} />}
    pet={null}
    prompt="今天想聊点什么？"
    thread={thread}
    composer={composer}
  />
}
