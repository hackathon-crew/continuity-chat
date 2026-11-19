import { BellSimpleIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, DownloadSimpleIcon, FileTextIcon, ListChecksIcon, PresentationChartIcon, SlidersHorizontalIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useStreamPacer } from '../everplain/app/agent/useStreamPacer'
import { ConversationActivity } from '../everplain/app/conversation-view/ConversationActivity'
import { ConversationComposer } from '../everplain/app/conversation-view/ConversationComposer'
import { ConversationLayout } from '../everplain/app/conversation-view/ConversationLayout'
import { ConversationThinking } from '../everplain/app/conversation-view/ConversationThinking'
import { flyBubble, takeLaunch } from '../everplain/app/conversation-view/sendFlight'
import '../everplain/app/conversation-view/conversation-view.css'
import { Octopus } from '../inkpaw/Octopus'
import type { Mood } from '../inkpaw/inkpaw-octopus'
import { agent, type AgentItem, type AgentJob } from './data'
import { Markdown } from './parts'

type AgentPageProps = {
  items: AgentItem[]
  jobs: AgentJob[]
  pending: boolean
  mood: Mood
  onSend: (text: string) => void
  onOpenSettings: () => void
  openJobs?: number
}

function AgentBubble({ text, streaming }: { text: string; streaming?: boolean }) {
  const pacer = useStreamPacer(text, Boolean(streaming))
  return <div className="xb-bubble"><Markdown text={pacer.visible} reveal={pacer} /></div>
}

function UserBubble({ text, live }: { text: string; live?: boolean }) {
  const bubble = useRef<HTMLDivElement>(null)
  const launched = useRef(live)
  useLayoutEffect(() => {
    const node = bubble.current
    if (!node || !launched.current) return
    const from = takeLaunch(text)
    if (!from) return
    node.setAttribute('data-awaiting-flight', '')
    let cancel: (() => void) | undefined
    const raf = requestAnimationFrame(() => { cancel = flyBubble(node, from) })
    return () => { cancelAnimationFrame(raf); cancel?.(); node.removeAttribute('data-awaiting-flight') }
  }, [text])
  return <div className="cv-turn__question"><div ref={bubble} className="qx-bubble xb-bubble--user">{text}</div></div>
}

function FileCard({ name, meta }: { name: string; meta: string }) {
  const Icon = name.endsWith('.pptx') ? PresentationChartIcon : FileTextIcon
  return <div className="xb-file">
    <Icon className="xb-file__icon" aria-hidden="true" />
    <span className="xb-file__text"><strong>{name}</strong><span className="qx-meta">{meta}</span></span>
    <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`下载 ${name}`}><DownloadSimpleIcon /></button>
  </div>
}

function Reminder({ title, rule }: { title: string; rule: string }) {
  const [on, setOn] = useState(true)
  return <div className="xb-file">
    <BellSimpleIcon className="xb-file__icon" aria-hidden="true" />
    <span className="xb-file__text"><strong>{title}</strong><span className="qx-meta">{rule}</span></span>
    <button type="button" className="qx-switch" role="switch" aria-checked={on} aria-label={`${title}${on ? '已开启' : '已关闭'}`} onClick={() => setOn(value => !value)} />
  </div>
}

function Item({ item }: { item: AgentItem }) {
  switch (item.kind) {
    case 'time': return <p className="qx-meta xb-time">{item.label}</p>
    case 'user': return <div className="xb-row" data-from="user"><UserBubble text={item.text} live={item.live} /></div>
    case 'agent': return <div className="xb-row" data-from="agent"><AgentBubble text={item.text} streaming={item.streaming} /></div>
    case 'file': return <div className="xb-row" data-from="agent"><FileCard name={item.name} meta={item.meta} /></div>
    case 'reminder': return <div className="xb-row" data-from="agent"><Reminder title={item.title} rule={item.rule} /></div>
    case 'activity': return <div className="xb-row xb-row--activity" data-from="agent"><ConversationActivity steps={item.steps} /></div>
  }
}

const jobGroups = [
  ['running', '正在做'],
  ['scheduled', '定时任务'],
  ['done', '最近完成'],
] as const

function JobsPanel({ jobs, onClose }: { jobs: AgentJob[]; onClose: () => void }) {
  return <div className="qx-panel cv-source-panel xb-jobs">
    <div className="cv-source-panel__head">
      <h2 className="qx-card__title">任务与提醒</h2>
      <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭任务与提醒" onClick={onClose}><XIcon /></button>
    </div>
    <div className="cv-source-panel__list">
      {jobGroups.map(([state, label]) => {
        const list = jobs.filter(job => job.state === state)
        if (!list.length) return null
        return <section key={state}>
          <h3>{label}<span>{list.length}</span></h3>
          <ul className="cv-source-panel__rows">{list.map(job => <li key={job.id}>
            <button type="button" className="qx-btn qx-btn--ghost">
              <span className="cv-tool-state" data-state={job.state === 'running' ? 'running' : job.state === 'done' ? 'completed' : undefined}>
                {job.state === 'running' ? <CircleNotchIcon aria-hidden="true" /> : job.state === 'done' ? <CheckCircleIcon aria-hidden="true" /> : <ClockIcon aria-hidden="true" />}
              </span>
              <span className="xb-job"><strong>{job.title}</strong><span className="qx-meta">{job.detail}</span></span>
            </button>
          </li>)}</ul>
        </section>
      })}
    </div>
  </div>
}

export function AgentPage({ items, jobs, pending, mood, onSend, onOpenSettings, openJobs }: AgentPageProps) {
  const [value, setValue] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [jobsOpen, setJobsOpen] = useState(false)
  const [jobsClosing, setJobsClosing] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const streaming = items.some(item => item.kind === 'agent' && item.streaming)
  const lastLength = (() => { const last = items.at(-1); return last && 'text' in last ? last.text.length : 0 })()
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [items.length, lastLength, pending])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [])
  useEffect(() => { if (openJobs) setJobsOpen(true) }, [openJobs])

  function closeJobs() {
    setJobsClosing(true)
    window.setTimeout(() => { setJobsOpen(false); setJobsClosing(false) }, 160)
  }
  function send() {
    const text = value.trim()
    if (!text || pending || streaming) return
    onSend(text)
    setValue('')
  }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
  }
  const running = jobs.filter(job => job.state === 'running').length

  const thread = <div className="xb-agent-thread" style={{ '--agent-color': 'var(--qx-color-data-blue)' } as CSSProperties}>
    {items.map(item => <Item key={item.id} item={item} />)}
    {pending ? <div className="xb-row" data-from="agent"><ConversationThinking turn={{ id: 'typing', question: '', answer: '', streaming: true, statusText: `${agent.name} 正在输入` }} /></div> : null}
    <div ref={endRef} />
  </div>

  return <div className="xb-agent-page">
    <ConversationLayout
      embedded={false}
      empty={false}
      research={false}
      runtimeMode="standard"
      sourceOpen={jobsOpen}
      sourceClosing={jobsClosing}
      title={agent.name}
      label={`和 ${agent.name} 的对话`}
      modes={<div className="cv-mode-switch" />}
      actions={<div className="xb-agent-actions">
        <button type="button" className="qx-btn qx-btn--ghost" aria-expanded={jobsOpen} onClick={() => jobsOpen ? closeJobs() : setJobsOpen(true)}>
          <ListChecksIcon aria-hidden="true" /><span>任务</span>{running ? <span className="xb-count">{running}</span> : null}
        </button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`${agent.name} 的设定和记忆`} title="设定和记忆" onClick={onOpenSettings}><SlidersHorizontalIcon /></button>
      </div>}
      pet={null}
      companionBar={<div className="xb-agent-hero">
        <Octopus className="xb-agent-hero__avatar" size={80} res={40} mood={mood} label={agent.name} />
        <span className="xb-agent-hero__name">{agent.name}</span>
      </div>}
      prompt=""
      thread={thread}
      source={<JobsPanel jobs={jobs} onClose={closeJobs} />}
      composer={<ConversationComposer
        scopeKey="agent"
        mode="standard"
        value={value}
        label={`给 ${agent.name} 发消息`}
        placeholder={`和 ${agent.name} 说点什么`}
        maxLength={8000}
        busy={false}
        canSend={Boolean(value.trim()) && !pending && !streaming}
        canStop={false}
        uploading={false}
        toolsOpen={toolsOpen}
        inputRef={inputRef}
        toolsRef={toolsRef}
        toolsButtonRef={toolsButtonRef}
        fileRef={fileRef}
        accept=".pdf,.docx,.txt,.md,.png,.jpg"
        attachments={[]}
        tools={<div className="cv-tool-attachments">
          <button className="qx-btn" type="button" role="menuitem" onClick={() => { setToolsOpen(false); fileRef.current?.click() }}><FileTextIcon aria-hidden="true" />发一份文件</button>
          <button className="qx-btn" type="button" role="menuitem" onClick={() => { setToolsOpen(false); setValue('每天晚上九点提醒我'); inputRef.current?.focus() }}><BellSimpleIcon aria-hidden="true" />设一个提醒</button>
        </div>}
        onChange={setValue}
        onKeyDown={keyDown}
        onSubmit={event => { event.preventDefault(); send() }}
        onStop={() => {}}
        onToggleTools={() => setToolsOpen(value => !value)}
        onUpload={() => {}}
        onRemoveAttachment={() => {}}
      />}
    />
  </div>
}
