import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { SettingsModal } from '../vendor/everplain/app/ui/SettingsModal'
import '../vendor/everplain/app/ui/settings-modal.css'
import { AgentSettings, ToolsSettings } from '../modules/agent/AgentSettings'
import type { Billing, User } from '../../contract/types'
import { displayDate } from '../shared/displayDate'
import type { useUni } from '../modules/agent/useAgent'

export type SettingsTab = 'agent' | 'tools' | 'account' | 'appearance'
export type Scheme = 'system' | 'light' | 'dark'

function AccountTab({
  user,
  billing,
  onSignOut,
  onPage,
}: {
  user: User
  billing?: Billing
  onSignOut: () => void
  onPage: (page: number) => void
}) {
  const usage = billing?.usage
  const rows = usage?.items ?? []
  return (
    <div className="xb-settings__section">
      <div className="xb-balance">
        <div>
          <span className="qx-meta">UniGate 余额</span>
          <strong className="qx-section-title">
            {billing ? `¥${billing.balance.toFixed(2)}` : '—'}
          </strong>
          <span className="qx-meta">
            {billing ? `本月已用 ¥${billing.monthSpend.toFixed(2)} · ` : ''}
            {user.account}
          </span>
          {billing && billing.frozenBalance > 0 ? (
            <span className="qx-meta">冻结 ¥{billing.frozenBalance.toFixed(2)}</span>
          ) : null}
        </div>
        {billing ? (
          <a
            className="qx-btn qx-btn--primary"
            href={billing.rechargeUrl}
            target="_blank"
            rel="noreferrer"
          >
            去 UniGate 充值
            <ArrowSquareOutIcon aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <p className="qx-meta xb-settings__lede">
        和 UniGate 控制台用同一个账户，聊天按模型的 token 用量从余额里扣，价格和控制台一致。
      </p>
      <div className="xb-table-wrap">
        <table className="qx-data-table xb-usage">
          <thead>
            <tr>
              <th>日期</th>
              <th>模型</th>
              <th>用量</th>
              <th>费用（元）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{displayDate(row.created_at)}</td>
                <td>{row.model}</td>
                <td>
                  {(
                    row.input_tokens +
                    row.output_tokens +
                    (row.cache_creation_tokens ?? 0) +
                    (row.cache_read_tokens ?? 0)
                  ).toLocaleString()}
                </td>
                <td className="xb-num">{row.actual_cost.toFixed(4)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="qx-meta">
                  {billing ? '暂无用量记录' : '正在读取 UniGate 用量'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {usage && usage.total > usage.page_size ? (
        <div className="xb-settings__row">
          <button
            className="qx-btn qx-btn--ghost"
            type="button"
            disabled={usage.page <= 1}
            onClick={() => onPage(usage.page - 1)}
          >
            上一页
          </button>
          <span className="qx-meta">第 {usage.page} 页</span>
          <button
            className="qx-btn qx-btn--ghost"
            type="button"
            disabled={usage.page * usage.page_size >= usage.total}
            onClick={() => onPage(usage.page + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
      <div>
        <button type="button" className="qx-btn qx-btn--ghost" onClick={onSignOut}>
          退出登录
        </button>
      </div>
    </div>
  )
}

function AppearanceTab({
  scheme,
  onScheme,
}: {
  scheme: Scheme
  onScheme: (scheme: Scheme) => void
}) {
  return (
    <div className="xb-settings__section">
      <div className="xb-settings__row">
        <div>
          <strong>颜色</strong>
          <span className="qx-meta">深色和浅色共用同一套令牌</span>
        </div>
        <div className="qx-segmented" role="radiogroup" aria-label="颜色">
          {(
            [
              ['system', '跟随系统'],
              ['light', '浅色'],
              ['dark', '深色'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-pressed={scheme === id}
              aria-checked={scheme === id}
              onClick={() => onScheme(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SettingsDialog({
  tab,
  onTab,
  onClose,
  scheme,
  onScheme,
  user,
  billing,
  onBillingPage,
  onSignOut,
  uni,
}: {
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  onClose: () => void
  scheme: Scheme
  onScheme: (scheme: Scheme) => void
  user: User
  billing?: Billing
  onBillingPage: (page: number) => void
  uni: ReturnType<typeof useUni>
  onSignOut: () => void
}) {
  const tabs: [SettingsTab, string][] = [
    ['agent', uni.profile.name],
    ['tools', '工具'],
    ['account', '账户与余额'],
    ['appearance', '外观'],
  ]
  return (
    <SettingsModal onClose={onClose} label="设置" accountName="设置">
      <div className="xb-settings">
        <nav className="xb-settings__nav" aria-label="设置分类">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="qx-item"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => onTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="xb-settings__body">
          {tab === 'agent' ? (
            <AgentSettings uni={uni} />
          ) : tab === 'tools' ? (
            <ToolsSettings uni={uni} />
          ) : tab === 'account' ? (
            <AccountTab
              user={user}
              billing={billing}
              onPage={onBillingPage}
              onSignOut={onSignOut}
            />
          ) : (
            <AppearanceTab scheme={scheme} onScheme={onScheme} />
          )}
        </div>
      </div>
    </SettingsModal>
  )
}
