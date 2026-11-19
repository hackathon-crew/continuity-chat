import { CircleNotchIcon, ClockCounterClockwiseIcon, GearSixIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApplicationFrame } from '../everplain/app/application-frame/ApplicationFrame'
import '../everplain/app/application-frame/application-frame.css'
import { NavIcon } from '../everplain/app/ui/NavIcon'
import type { Mood } from '../inkpaw/inkpaw-octopus'
import { AgentPage } from './AgentPage'
import { ChatPage } from './ChatPage'
import { agent, agentJobs, agentThread, conversations as initialConversations, importCandidates, scriptedAgentReplies, scriptedChatReply, user, type AgentItem, type Conversation, type Turn } from './data'
import { ImportDialog, type ImportStep } from './ImportDialog'
import { LoginPage } from './LoginPage'
import { BrandName, OctoMark } from './parts'
import { SettingsDialog, type Scheme, type SettingsTab } from './SettingsDialog'
import './app.css'

type View = { kind: 'agent' } | { kind: 'chat'; id: string }

const groups: [Conversation['group'][], string][] = [[['pinned'], '置顶'], [['today', 'yesterday', 'earlier'], '最近']]
let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`

function useNarrow() {
  const query = '(max-width: 760px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

export function App() {
  const narrow = useNarrow()
  const [signedIn, setSignedIn] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [view, setView] = useState<View>({ kind: 'agent' })
  const [chats, setChats] = useState<Conversation[]>(initialConversations)
  const [draft, setDraft] = useState<Conversation | null>(null)
  const [items, setItems] = useState<AgentItem[]>(agentThread)
  const [jobs, setJobs] = useState(agentJobs)
  const [pending, setPending] = useState(false)
  const [mood, setMood] = useState<Mood>('idle')
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [importing, setImporting] = useState(false)
  const [importStep, setImportStep] = useState<ImportStep>('pick')
  const [jobsSignal, setJobsSignal] = useState(0)
  const [scheme, setScheme] = useState<Scheme>('system')
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const timers = useRef<number[]>([])
  const sidebarRef = useRef<HTMLElement>(null)
  const later = useCallback((fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)) }, [])
  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  useEffect(() => {
    const root = document.documentElement
    if (scheme === 'system') root.removeAttribute('data-color-scheme')
    else root.setAttribute('data-color-scheme', scheme)
  }, [scheme])

  // 周报 PPT 是一个正在跑的后台任务：开页 25 秒后完成，团子主动来报。
  useEffect(() => {
    later(() => {
      setChats(list => list.map(chat => ({ ...chat, turns: chat.turns.map(turn => turn.task ? { ...turn, task: { ...turn.task, status: 'done' } } : turn) })))
      setJobs(list => list.map(job => job.id === 'j1' ? { ...job, state: 'done', detail: '刚刚 · 5 页' } : job))
      setItems(list => [...list,
        { kind: 'time', id: nextId('t'), label: '刚刚' },
        { kind: 'agent', id: nextId('a'), text: '周报的 PPT 做好了，5 页。第 3 页的原型截图我用的是你周二发的那版，换新的跟我说一声。' },
        { kind: 'file', id: nextId('f'), name: '周报_第47周.pptx', meta: '演示文稿 · 5 页' },
      ])
      setMood('happy')
      later(() => setMood('idle'), 2400)
    }, 25000)
  }, [later])

  const current = view.kind === 'chat' ? chats.find(chat => chat.id === view.id) ?? (draft?.id === view.id ? draft : null) : null
  const running = useMemo(() => new Set(chats.filter(chat => chat.turns.some(turn => turn.task?.status === 'running' || turn.streaming)).map(chat => chat.id)), [chats])

  function go(next: View) { setView(next); if (narrow) setDrawer(false) }
  function newChat() {
    const id = nextId('chat')
    setDraft({ id, title: '新对话', group: 'today', model: 'deepseek-flash', turns: [] })
    go({ kind: 'chat', id })
  }
  const patchTurn = (chatId: string, turnId: string, patch: (turn: Turn) => Turn) =>
    setChats(list => list.map(chat => chat.id === chatId ? { ...chat, turns: chat.turns.map(turn => turn.id === turnId ? patch(turn) : turn) } : chat))

  function sendChat(text: string, options: { search: boolean; handoff: boolean }) {
    if (!current) return
    const turnId = nextId('turn')
    const turn: Turn = { id: turnId, question: text, answer: '', streaming: true, statusText: '正在思考' }
    if (draft?.id === current.id) {
      setChats(list => [{ ...current, title: text.slice(0, 16), turns: [turn] }, ...list])
      setDraft(null)
    } else setChats(list => list.map(chat => chat.id === current.id ? { ...chat, turns: [...chat.turns, turn] } : chat))
    const chatId = current.id
    const full = options.handoff ? `好，交给${agent.name}去做了。它会先列个大纲，做好放在它那边，你可以继续在这里聊别的。` : scriptedChatReply
    let start = 700
    if (options.search) {
      later(() => patchTurn(chatId, turnId, value => ({ ...value, statusText: '正在联网搜索', steps: [{ id: 's', label: `联网搜索：${text.slice(0, 18)}`, status: 'running' }] })), 600)
      later(() => patchTurn(chatId, turnId, value => ({ ...value, steps: value.steps?.map(step => ({ ...step, status: 'completed', resultItems: [{ id: 'x', title: '找到 4 个相关网页', excerpt: '已读取其中 2 个' }] })) })), 2000)
      start = 2200
    }
    let last = start
    for (let at = 0, i = 0; at < full.length; i++) {
      const end = Math.min(full.length, at + 6 + (i % 5))
      const slice = full.slice(0, end)
      last = start + i * 70
      later(() => patchTurn(chatId, turnId, value => ({ ...value, answer: slice })), last)
      at = end
    }
    const finish = last + 300
    later(() => patchTurn(chatId, turnId, value => ({ ...value, streaming: false, ...(options.handoff ? { task: { title: text.slice(0, 20), status: 'running' as const } } : {}) })), finish)
    if (options.handoff) {
      later(() => setJobs(list => [{ id: nextId('j'), title: text.slice(0, 20), detail: `来自「${current.title}」· 刚开始`, state: 'running' }, ...list]), finish)
    }
  }

  function sendAgent(text: string) {
    setItems(list => [...list, { kind: 'user', id: nextId('u'), text, live: true }])
    let at = 500
    scriptedAgentReplies.forEach((reply, index) => {
      const id = nextId('a')
      later(() => { setPending(true); setMood('think') }, at)
      at += 900 + index * 500
      later(() => { setPending(false); setMood('talk'); setItems(list => [...list, { kind: 'agent', id, text: reply, streaming: true }]) }, at)
      at += Math.max(500, reply.length * 22)
      later(() => setItems(list => list.map(item => item.id === id && item.kind === 'agent' ? { ...item, streaming: false } : item)), at)
      at += 300
    })
    later(() => setMood('happy'), at)
    later(() => setMood('idle'), at + 2200)
  }

  function imported(ids: string[]) {
    setImporting(false)
    const fresh = importCandidates.filter(item => ids.includes(item.id) && !chats.some(chat => chat.title.startsWith(item.title)))
    const added: Conversation[] = fresh.map(item => ({ id: `imported-${item.id}`, title: item.title, group: 'earlier', model: 'deepseek-flash', imported: { messages: item.messages, last: item.last }, turns: [{ id: `${item.id}-t`, question: '我们上次聊到哪了？', answer: `上次聊到「${item.title}」的最后一段，你说想换个角度再试试。要从那里接着来吗？` }] }))
    setChats(list => [...list, ...added])
    const first = added[0]?.id ?? chats.find(chat => chat.imported)?.id
    if (first) go({ kind: 'chat', id: first })
  }

  const openImport = (step: ImportStep) => { setImportStep(step); setImporting(true); if (narrow) setDrawer(false) }
  const mockPages: [string, () => void][] = [
    [`${agent.name}（Personal Agent）`, () => go({ kind: 'agent' })],
    [`${agent.name}：任务与提醒`, () => { go({ kind: 'agent' }); setJobsSignal(value => value + 1) }],
    ['新对话（空状态）', newChat],
    ['普通对话：交给团子的任务卡', () => go({ kind: 'chat', id: 'weekly' })],
    ['普通对话：联网搜索步骤', () => go({ kind: 'chat', id: 'cat' })],
    ['从 DeepSeek 导入的对话', () => go({ kind: 'chat', id: 'rain-store' })],
    ['导入：选择文件', () => openImport('pick')],
    ['导入：选择对话', () => openImport('select')],
    ['导入：完成', () => openImport('done')],
    [`设置：${agent.name}与记忆`, () => setSettings('agent')],
    ['设置：工具', () => setSettings('tools')],
    ['设置：账户与余额', () => setSettings('account')],
    ['设置：外观', () => setSettings('appearance')],
    ['登录页', () => setSignedIn(false)],
  ]
  const shown = chats.filter(chat => !filter.trim() || chat.title.includes(filter.trim()))
  const history = <div>
    {searching ? <div className="qx-search xb-sidebar-search"><MagnifyingGlassIcon aria-hidden="true" /><input autoFocus aria-label="搜索对话" placeholder="搜索对话" value={filter} onChange={event => setFilter(event.target.value)} onBlur={() => { if (!filter) setSearching(false) }} /></div> : null}
    {groups.map(([group, label]) => {
      const list = shown.filter(chat => group.includes(chat.group))
      if (!list.length) return null
      return <section key={label} className="xb-history-group">
        <h2 className="qx-group-label">{label}</h2>
        {list.map(chat => <button key={chat.id} type="button" className="qx-item application-history__conversation xb-history-item" aria-current={view.kind === 'chat' && view.id === chat.id ? 'page' : undefined} title={chat.title} onClick={() => go({ kind: 'chat', id: chat.id })}>
          <span>{chat.title}</span>
          {running.has(chat.id) ? <CircleNotchIcon className="cv-spin xb-history-item__state" aria-label="进行中" /> : chat.imported ? <ClockCounterClockwiseIcon className="xb-history-item__state" aria-label="从 DeepSeek 导入" /> : null}
        </button>)}
      </section>
    })}
    {!shown.length ? <p className="qx-meta application-history__hint">没有找到「{filter}」</p> : null}
  </div>

  if (!signedIn) return <ApplicationFrame
    collapsed={false} drawerOpen={false} narrow={narrow} immersive workspace={false} wide sidebarRef={sidebarRef}
    brand={null} toggle={null} newConversation={null} navigation={null} secondaryNavigation={null} history={null} account={null} notifications={null} mobileHeader={null} notice={null}
    skipLabel="跳到主要内容" sidebarLabel="Unigate Chat 功能栏" dismissLabel="关闭菜单" onDismiss={() => {}}
  ><div className="application-content"><LoginPage onSignIn={() => { setSignedIn(true); setView({ kind: 'agent' }) }} /></div></ApplicationFrame>

  return <>
    <ApplicationFrame
      collapsed={collapsed && !narrow}
      drawerOpen={drawer}
      narrow={narrow}
      immersive={false}
      workspace
      wide
      sidebarRef={sidebarRef}
      skipLabel="跳到主要内容"
      sidebarLabel="Unigate Chat 功能栏"
      dismissLabel="关闭菜单"
      onDismiss={() => setDrawer(false)}
      notice={null}
      brand={<a className="application-brand xb-brand-link" href="#" onClick={event => { event.preventDefault(); go({ kind: 'agent' }) }}><BrandName /></a>}
      toggle={<button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={narrow ? '关闭菜单' : collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => narrow ? setDrawer(false) : setCollapsed(value => !value)}>{narrow ? <NavIcon name="close" /> : <NavIcon name="sidebar" />}</button>}
      newConversation={<button type="button" className="qx-item" title="新对话" onClick={newChat}><NavIcon name="compose" /><span className="application-navigation__label">新对话</span></button>}
      navigation={<nav className="application-navigation" aria-label="主导航">
        <button type="button" className="qx-item xb-agent-item" title={agent.name} aria-current={view.kind === 'agent' ? 'page' : undefined} onClick={() => go({ kind: 'agent' })}>
          <span className="application-nav-icon xb-agent-item__mark"><OctoMark size={20} /></span>
          <span className="application-navigation__label">{agent.name}</span>
        </button>
        <button type="button" className="qx-item" title="导入 DeepSeek 记录" onClick={() => openImport('pick')}><NavIcon name="import" /><span className="application-navigation__label">导入 DeepSeek 记录</span></button>
      </nav>}
      secondaryNavigation={<details className="application-more">
        <summary className="qx-item" title="全部 mock 页面"><NavIcon name="more" /><span className="application-navigation__label">全部 mock 页面</span><NavIcon name="chevron" className="application-group-chevron" /></summary>
        <nav className="application-navigation" aria-label="全部 mock 页面">
          {mockPages.map(([label, open]) => <button key={label} type="button" className="qx-item" title={label} onClick={open}><span className="application-navigation__label">{label}</span></button>)}
        </nav>
      </details>}
      history={history}
      account={<div className="application-account">
        <div className="application-account-menu">
          <button type="button" className="qx-item application-account__identity" onClick={() => setSettings('account')}>
            <span className="qx-avatar xb-user-avatar" aria-hidden="true">林</span>
            <span className="application-account__name xb-account"><span>{user.name}</span><span className="qx-meta">余额 ¥{user.balance.toFixed(2)}</span></span>
          </button>
        </div>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="设置" onClick={() => setSettings('agent')}><GearSixIcon /></button>
      </div>}
      notifications={null}
      mobileHeader={<>
        <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="打开菜单" aria-expanded={drawer} aria-controls="application-sidebar" onClick={() => setDrawer(true)}><NavIcon name="menu" /></button>
        <a className="application-brand" href="#" onClick={event => { event.preventDefault(); go({ kind: 'agent' }) }}><BrandName /></a>
        <button data-mobile-new className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="新对话" onClick={newChat}><NavIcon name="compose" /></button>
      </>}
    >
      <div className="application-content">
        {view.kind === 'agent' ? <AgentPage items={items} jobs={jobs} pending={pending} mood={mood} onSend={sendAgent} onOpenSettings={() => setSettings('agent')} openJobs={jobsSignal} />
          : current ? <ChatPage key={current.id} conversation={current} balance={user.balance} onSend={sendChat}
            onModelChange={model => { if (draft?.id === current.id) setDraft({ ...current, model }); else setChats(list => list.map(chat => chat.id === current.id ? { ...chat, model } : chat)) }}
            onOpenAgent={() => go({ kind: 'agent' })} onOpenImport={() => openImport('pick')} /> : null}
      </div>
    </ApplicationFrame>
    {settings ? <SettingsDialog tab={settings} onTab={setSettings} onClose={() => setSettings(null)} scheme={scheme} onScheme={setScheme} onSignOut={() => { setSettings(null); setSignedIn(false) }} /> : null}
    {importing ? <ImportDialog key={importStep} initialStep={importStep} onClose={() => setImporting(false)} onImported={imported} /> : null}
  </>
}
