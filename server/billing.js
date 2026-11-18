import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { HttpError } from './http.js'

export const plans = [
  {
    id: 'free',
    name: '初见',
    price: 0,
    currency: 'cny',
    interval: 'month',
    description: '导入 DeepSeek，接回原来的对话',
    features: ['DeepSeek 历史导入', 'Soul 与 Memory', '自有 API Key', '本地历史导出'],
  },
  {
    id: 'plus',
    name: '续伴',
    price: 2900,
    currency: 'cny',
    interval: 'month',
    description: '给长期陪伴一个稳定的家',
    features: ['不限聊天轮数', '平台 API Key', '主动消息与定时任务', 'Personal Agent'],
  },
  {
    id: 'pro',
    name: '共创',
    price: 5900,
    currency: 'cny',
    interval: 'month',
    description: '为高频创作与自动化而生',
    features: ['包含续伴全部能力', '自定义 Webhook 工具', '多任务自动化', '优先支持'],
  },
]

const activeSubscription = (data, userId) =>
  data.subscriptions.find((item) => item.userId === userId)

export const billingSnapshot = (store, userId) =>
  store.read((data) => ({
    plans,
    subscription: activeSubscription(data, userId) ?? {
      planId: 'free',
      status: 'active',
      cancelAtPeriodEnd: false,
      provider: 'none',
    },
    invoices: data.invoices
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt),
    stripeConfigured: Boolean(config.stripeSecretKey),
    demoMode: config.demoMode,
  }))

async function stripeRequest(path, method = 'POST', body) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new HttpError(502, result.error?.message ?? '支付服务暂时不可用', 'billing_error')
  }
  return result
}

async function setSubscription(store, userId, update) {
  return store.update((data) => {
    let subscription = activeSubscription(data, userId)
    if (!subscription) {
      subscription = { id: randomUUID(), userId, planId: 'free', status: 'active' }
      data.subscriptions.push(subscription)
    }
    Object.assign(subscription, update, { updatedAt: Date.now() })
    return subscription
  })
}

export async function checkout(store, user, planId) {
  const plan = plans.find((item) => item.id === planId)
  if (!plan) {
    throw new HttpError(404, '套餐不存在', 'plan_not_found')
  }
  if (plan.id === 'free') {
    await setSubscription(store, user.id, {
      planId: 'free',
      status: 'active',
      provider: 'none',
      cancelAtPeriodEnd: false,
    })
    return { demo: false, complete: true }
  }
  const priceId = config.stripePrices[plan.id]
  if (config.stripeSecretKey && priceId) {
    const session = await stripeRequest('/v1/checkout/sessions', 'POST', {
      mode: 'subscription',
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${config.publicUrl}/?billing=success`,
      cancel_url: `${config.publicUrl}/?billing=cancelled`,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'metadata[planId]': plan.id,
      'subscription_data[metadata][planId]': plan.id,
      'subscription_data[metadata][userId]': user.id,
    })
    return { url: session.url, demo: false }
  }
  if (!config.demoMode) {
    throw new HttpError(503, '在线支付尚未配置', 'billing_not_configured')
  }
  const now = Date.now()
  const subscription = await setSubscription(store, user.id, {
    planId: plan.id,
    status: 'active',
    provider: 'demo',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
  })
  await store.update((data) => {
    data.invoices.push({
      id: randomUUID(),
      userId: user.id,
      planId: plan.id,
      amount: plan.price,
      currency: plan.currency,
      status: 'demo',
      description: '演示支付，未发生真实扣款',
      createdAt: now,
    })
  })
  return { demo: true, complete: true, subscription }
}

export async function changeCancellation(store, user, cancel) {
  const current = billingSnapshot(store, user.id).subscription
  if (!current.planId || current.planId === 'free') {
    throw new HttpError(400, '当前没有付费订阅')
  }
  if (current.provider === 'stripe' && current.stripeSubscriptionId) {
    await stripeRequest(`/v1/subscriptions/${current.stripeSubscriptionId}`, 'POST', {
      cancel_at_period_end: String(cancel),
    })
  }
  return setSubscription(store, user.id, { cancelAtPeriodEnd: cancel })
}

export async function createPortalSession(user) {
  if (!config.stripeSecretKey || !user.stripeCustomerId) {
    throw new HttpError(400, '当前订阅无需管理外部支付账户')
  }
  const session = await stripeRequest('/v1/billing_portal/sessions', 'POST', {
    customer: user.stripeCustomerId,
    return_url: config.publicUrl,
  })
  return session.url
}

function verifyStripeSignature(raw, header) {
  if (!config.stripeWebhookSecret || !header) {
    throw new HttpError(400, 'Webhook 签名缺失')
  }
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')))
  const expected = createHmac('sha256', config.stripeWebhookSecret)
    .update(`${parts.t}.${raw}`)
    .digest()
  const actual = Buffer.from(parts.v1 ?? '', 'hex')
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t))
  if (age > 300 || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(400, 'Webhook 签名无效')
  }
}

export async function handleStripeWebhook(store, raw, signature) {
  verifyStripeSignature(raw, signature)
  const event = JSON.parse(raw.toString('utf8'))
  const object = event.data?.object ?? {}
  if (event.type === 'checkout.session.completed') {
    const userId = object.client_reference_id ?? object.metadata?.userId
    if (!userId) {
      return { received: true }
    }
    await store.update((data) => {
      const user = data.users.find((item) => item.id === userId)
      if (user) {
        user.stripeCustomerId = object.customer
      }
    })
    await setSubscription(store, userId, {
      planId: object.metadata?.planId ?? 'plus',
      status: 'active',
      provider: 'stripe',
      stripeSubscriptionId: object.subscription,
      cancelAtPeriodEnd: false,
    })
  }
  if (['customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    const user = store.read((data) =>
      data.users.find(
        (item) => item.id === object.metadata?.userId || item.stripeCustomerId === object.customer
      )
    )
    if (user) {
      const planId = plans.find(
        (plan) => config.stripePrices[plan.id] === object.items?.data?.[0]?.price?.id
      )?.id
      await setSubscription(store, user.id, {
        planId: event.type.endsWith('deleted')
          ? 'free'
          : (object.metadata?.planId ?? planId ?? 'plus'),
        status: object.status,
        provider: 'stripe',
        stripeSubscriptionId: object.id,
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
        currentPeriodEnd: object.current_period_end ? object.current_period_end * 1000 : undefined,
      })
    }
  }
  return { received: true }
}
