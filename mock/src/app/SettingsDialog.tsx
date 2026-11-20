import { ArrowSquareOutIcon, PencilSimpleIcon, PlugsConnectedIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { SettingsModal } from '../everplain/app/ui/SettingsModal'
import '../everplain/app/ui/settings-modal.css'
import { Octopus } from '../inkpaw/Octopus'
import { agent, memories as initialMemories, tools as initialTools, usage, user } from './data'

export type SettingsTab = 'agent' | 'tools' | 'account' | 'appearance'
export type Scheme = 'system' | 'light' | 'dark'

const tabs: [SettingsTab, string][] = [
  ['agent', agent.name],
  ['tools', '工具'],
  ['account', '账户与余额'],
  ['appearance', '外观'],
]

function AgentTab() {
  const [proactive, setProactive] = useState(true)
  const [items, setItems] = useState(initialMemories)
  return <div className="xb-settings__section">
    <div className="xb-settings__identity">
      <Octopus size={64} res={32} mood="idle" label={agent.name} />
      <div className="qx-field xb-settings__grow"><label htmlFor="agent-name">名字</label><input id="agent-name" className="qx-input" defaultValue={agent.name} /></div>
    </div>
    <div className="qx-field"><label htmlFor="agent-soul">性格和说话方式</label><textarea id="agent-soul" className="qx-textarea" defaultValue={agent.persona} /><small>它每次回复前都会读这段话</small></div>
    <div className="xb-settings__row">
      <div><strong>主动找你</strong><span className="qx-meta">到点提醒、事情有进展时发消息；23:00 到 8:00 不打扰</span></div>
      <button type="button" className="qx-switch" role="switch" aria-checked={proactive} aria-label="主动找你" onClick={() => setProactive(value => !value)} />
    </div>
    <div className="xb-settings__list">
      <div className="xb-settings__list-head"><h3 className="qx-heading">记忆</h3><span className="qx-meta">{items.length} 条，只有你能看到和修改</span></div>
      {items.map(memory => <div className="xb-memory" key={memory.id}>
        <div><p>{memory.text}</p><span className="qx-meta">{memory.from}</span></div>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`修改：${memory.text}`}><PencilSimpleIcon /></button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`删除：${memory.text}`} onClick={() => setItems(list => list.filter(item => item.id !== memory.id))}><TrashIcon /></button>
      </div>)}
      <button type="button" className="qx-btn qx-btn--ghost xb-settings__add"><PlusIcon aria-hidden="true" />添加一条记忆</button>
    </div>
  </div>
}

function ToolsTab() {
  const [items, setItems] = useState(initialTools)
  return <div className="xb-settings__section">
    <p className="qx-meta xb-settings__lede">对话和{agent.name}都能用打开的工具；{agent.name}在后台做任务时也会用到。</p>
    <div className="xb-settings__list">
      {items.map(tool => <div className="xb-settings__row" key={tool.id}>
        <div><strong>{tool.name}{tool.builtIn ? <span className="qx-tag">内置</span> : null}</strong><span className="qx-meta">{tool.detail}</span></div>
        <button type="button" className="qx-switch" role="switch" aria-checked={tool.on} aria-label={tool.name} onClick={() => setItems(list => list.map(item => item.id === tool.id ? { ...item, on: !item.on } : item))} />
      </div>)}
    </div>
    <div className="xb-settings__row">
      <div><strong>MCP 服务</strong><span className="qx-meta">填入服务地址，把你自己的工具接进来</span></div>
      <button type="button" className="qx-btn qx-btn--secondary"><PlugsConnectedIcon aria-hidden="true" />连接</button>
    </div>
  </div>
}

function AccountTab({ onSignOut }: { onSignOut: () => void }) {
  return <div className="xb-settings__section">
    <div className="xb-balance">
      <div>
        <span className="qx-meta">UniGate 余额</span>
        <strong className="qx-section-title">¥{user.balance.toFixed(2)}</strong>
        <span className="qx-meta">本月已用 ¥{user.monthSpend.toFixed(2)} · {user.account}</span>
      </div>
      <a className="qx-btn qx-btn--primary" href="https://unigate.top" target="_blank" rel="noreferrer">去 UniGate 充值<ArrowSquareOutIcon aria-hidden="true" /></a>
    </div>
    <p className="qx-meta xb-settings__lede">和 UniGate 控制台用同一个账户，聊天按模型的 token 用量从余额里扣，价格和控制台一致。</p>
    <div className="xb-table-wrap">
      <table className="qx-data-table xb-usage">
        <thead><tr><th>日期</th><th>模型</th><th>用量</th><th>费用（元）</th></tr></thead>
        <tbody>{usage.map((row, index) => <tr key={index}><td>{row.day}</td><td>{row.model}</td><td>{row.tokens}</td><td className="xb-num">{row.cost}</td></tr>)}</tbody>
      </table>
    </div>
    <div><button type="button" className="qx-btn qx-btn--ghost" onClick={onSignOut}>退出登录</button></div>
  </div>
}

function AppearanceTab({ scheme, onScheme }: { scheme: Scheme; onScheme: (scheme: Scheme) => void }) {
  return <div className="xb-settings__section">
    <div className="xb-settings__row">
      <div><strong>颜色</strong><span className="qx-meta">深色和浅色共用同一套令牌</span></div>
      <div className="qx-segmented" role="radiogroup" aria-label="颜色">
        {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([id, label]) => <button key={id} type="button" role="radio" aria-pressed={scheme === id} aria-checked={scheme === id} onClick={() => onScheme(id)}>{label}</button>)}
      </div>
    </div>
  </div>
}

export function SettingsDialog({ tab, onTab, onClose, scheme, onScheme, onSignOut }: { tab: SettingsTab; onTab: (tab: SettingsTab) => void; onClose: () => void; scheme: Scheme; onScheme: (scheme: Scheme) => void; onSignOut: () => void }) {
  return <SettingsModal onClose={onClose} label="设置" accountName="设置">
    <div className="xb-settings">
      <nav className="xb-settings__nav" aria-label="设置分类">
        {tabs.map(([id, label]) => <button key={id} type="button" className="qx-item" aria-current={tab === id ? 'page' : undefined} onClick={() => onTab(id)}>{label}</button>)}
      </nav>
      <div className="xb-settings__body">
        {tab === 'agent' ? <AgentTab /> : tab === 'tools' ? <ToolsTab /> : tab === 'account' ? <AccountTab onSignOut={onSignOut} /> : <AppearanceTab scheme={scheme} onScheme={onScheme} />}
      </div>
    </div>
  </SettingsModal>
}
