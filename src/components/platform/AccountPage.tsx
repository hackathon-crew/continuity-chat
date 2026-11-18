import { useEffect, useState } from 'react'
import {
  api,
  formatMoney,
  jsonBody,
  type BillingData,
  type PlatformUser,
} from '../../services/platform.js'
import { setApiKey } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import styles from './Platform.module.css'

export const AccountPage = ({
  user,
  onUser,
  onLogout,
}: {
  user: PlatformUser
  onUser: (user: PlatformUser) => void
  onLogout: () => void
}) => {
  const [mode, setMode] = useState(user.keyMode)
  const [key, setKey] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [billingBusy, setBillingBusy] = useState('')

  const loadBilling = async () => {
    try {
      setBilling(await api<BillingData>('/api/billing'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计费信息加载失败')
    }
  }
  useEffect(() => {
    void loadBilling()
  }, [])

  const saveKey = async () => {
    setKeyBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ user: PlatformUser }>('/api/settings/key', {
        method: 'PUT',
        body: jsonBody({ mode, apiKey: key }),
      })
      onUser(result.user)
      setApiKey(mode === 'platform' ? 'platform' : key || 'stored')
      setKey('')
      setNotice(
        mode === 'platform'
          ? '已切换为平台 API Key，聊天不设置条数限制。'
          : '自有 API Key 已校验并加密保存。'
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setKeyBusy(false)
    }
  }

  const subscribe = async (planId: string) => {
    setBillingBusy(planId)
    setError('')
    try {
      const result = await api<{ url?: string; demo?: boolean; complete?: boolean }>(
        '/api/billing/checkout',
        {
          method: 'POST',
          body: jsonBody({ planId }),
        }
      )
      if (result.url) {
        window.location.href = result.url
      } else {
        await loadBilling()
        setNotice(result.demo ? '演示订阅已生效，未发生真实扣款。' : '套餐已更新。')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '订阅失败')
    } finally {
      setBillingBusy('')
    }
  }

  const cancellation = async (cancel: boolean) => {
    setBillingBusy('cancel')
    try {
      await api(`/api/billing/${cancel ? 'cancel' : 'resume'}`, { method: 'POST' })
      await loadBilling()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '订阅更新失败')
    } finally {
      setBillingBusy('')
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.pageEyebrow}>Account</div>
          <h1 className={styles.pageTitle}>账户与计费</h1>
          <p className={styles.pageDescription}>
            {user.email} · 选择平台额度或使用自己的 DeepSeek API Key。
          </p>
        </div>
        <Button
          variant="outlined"
          size="m"
          onClick={async () => {
            await api('/api/auth/logout', { method: 'POST' })
            onLogout()
          }}
        >
          退出登录
        </Button>
      </header>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className={styles.status} role="status">
          {notice}
        </div>
      ) : null}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>模型连接</h2>
        <p className={styles.cardDescription}>
          平台模式不暴露平台密钥；自有 Key 经校验后加密保存，用于聊天、定时任务和 Personal
          Agent。不会限制聊天条数，但上游 API 仍受其服务与余额约束。
        </p>
        <div className={styles.field}>
          <label htmlFor="key-mode">API Key 来源</label>
          <select
            id="key-mode"
            className={styles.select}
            value={mode}
            onChange={(event) => setMode(event.target.value as 'platform' | 'byok')}
          >
            <option value="platform">使用平台提供的 API Key</option>
            <option value="byok">
              使用我自己的 API Key{user.hasStoredKey ? '（已保存）' : ''}
            </option>
          </select>
        </div>
        {mode === 'byok' ? (
          <div className={styles.field}>
            <label htmlFor="own-key">DeepSeek API Key</label>
            <input
              id="own-key"
              className={styles.input}
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={user.hasStoredKey ? '留空则沿用已保存的 Key' : 'sk-…'}
              autoComplete="off"
            />
          </div>
        ) : null}
        <Button
          size="m"
          disabled={keyBusy || (mode === 'byok' && !key && !user.hasStoredKey)}
          onClick={() => void saveKey()}
        >
          {keyBusy ? '正在校验…' : '保存模型连接'}
        </Button>
      </section>
      <div className={styles.gridThree}>
        {billing?.plans.map((plan) => (
          <section className={`${styles.card} ${styles.planCard}`} key={plan.id}>
            <div>
              <span className={styles.badge}>
                {billing.subscription.planId === plan.id ? '当前套餐' : plan.name}
              </span>
            </div>
            <div className={styles.planPrice}>
              {plan.price ? formatMoney(plan.price) : '免费'}
              <small> / 月</small>
            </div>
            <p className={styles.cardDescription}>{plan.description}</p>
            <ul className={styles.featureList}>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Button
              variant={billing.subscription.planId === plan.id ? 'outlined' : 'primary'}
              size="m"
              disabled={billingBusy !== '' || billing.subscription.planId === plan.id}
              onClick={() => void subscribe(plan.id)}
            >
              {billingBusy === plan.id ? '正在处理…' : plan.price ? '选择此套餐' : '切换至免费版'}
            </Button>
          </section>
        ))}
      </div>
      {billing ? (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>订阅状态</h2>
          <p className={styles.cardDescription}>
            {billing.subscription.status} ·{' '}
            {billing.subscription.provider === 'demo'
              ? '演示订阅（未扣款）'
              : billing.subscription.provider}
            {billing.subscription.currentPeriodEnd
              ? ` · 当前周期至 ${new Date(billing.subscription.currentPeriodEnd).toLocaleDateString()}`
              : ''}
          </p>
          {billing.subscription.planId !== 'free' ? (
            <Button
              variant="outlined"
              size="m"
              disabled={billingBusy !== ''}
              onClick={() => void cancellation(!billing.subscription.cancelAtPeriodEnd)}
            >
              {billing.subscription.cancelAtPeriodEnd ? '恢复自动续费' : '取消周期末续费'}
            </Button>
          ) : null}
          {!billing.stripeConfigured && billing.demoMode ? (
            <p className={styles.status}>
              当前为演示计费。配置 Stripe 后会跳转真实
              Checkout；此页面不会把演示订单描述为真实付款。
            </p>
          ) : null}
          {billing.invoices.length ? (
            <div>
              {billing.invoices.map((invoice) => (
                <div className={styles.invoiceItem} key={invoice.id}>
                  <span>{invoice.description}</span>
                  <span>
                    {formatMoney(invoice.amount, invoice.currency)} · {invoice.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <div className={styles.emptyState}>正在加载订阅信息…</div>
      )}
    </div>
  )
}
