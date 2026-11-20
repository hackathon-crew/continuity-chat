import { cookie, cookieValue, HttpError, redirect, sendJson } from './http.ts'
import { createToken, hashToken } from './security.ts'
import { loginLifetime, sessionLifetime } from './store.ts'

const loginCookie = 'continuity_oauth'
const sessionCookie = 'continuity_session'

export const publicUser = (user) => ({ id: String(user.id), name: user.name, account: user.email })

export async function startLogin(req, res, { store, unigate, settings }) {
  const state = createToken()
  const verifier = createToken()
  const browser = createToken()
  await store.addLogin(hashToken(state), hashToken(browser), verifier)
  return redirect(res, unigate.authorizeUrl(state, hashToken(verifier)), [
    cookie(settings, loginCookie, browser, loginLifetime),
  ])
}

export async function finishLogin(req, res, url, { store, unigate, settings }) {
  const clear = cookie(settings, loginCookie, '', 0)
  const state = url.searchParams.get('state')
  const browser = cookieValue(req, loginCookie)
  if (!state || !browser) {
    return redirect(res, '/?auth=expired', [clear])
  }
  const attempt = await store.consumeLogin(hashToken(state), hashToken(browser))
  if (!attempt) {
    return redirect(res, '/?auth=expired', [clear])
  }
  if (url.searchParams.has('error')) {
    return redirect(res, '/?auth=denied', [clear])
  }
  const code = url.searchParams.get('code')
  if (!code) {
    return redirect(res, '/?auth=expired', [clear])
  }

  try {
    const tokens = await unigate.exchange(code, attempt.verifier)
    const me = await unigate.account('/me', tokens.access)
    const { key } = await unigate.account('/key', tokens.access, 'POST')
    const token = createToken()
    await store.startSession(me, key, tokens, hashToken(token))
    const oldToken = cookieValue(req, sessionCookie)
    if (oldToken) {
      await store.endSession(hashToken(oldToken))
    }
    return redirect(res, '/', [clear, cookie(settings, sessionCookie, token, sessionLifetime)])
  } catch (error) {
    if (!(error instanceof HttpError)) {
      process.stderr.write(`${error.stack ?? String(error)}\n`)
    }
    const status = error.code === 'unigate_forbidden' ? 'permission' : 'unavailable'
    return redirect(res, `/?auth=${status}`, [clear])
  }
}

export async function logout(req, res, { store, settings }) {
  const token = cookieValue(req, sessionCookie)
  if (token) {
    await store.endSession(hashToken(token))
  }
  res.setHeader('Set-Cookie', cookie(settings, sessionCookie, '', 0))
  sendJson(res, 200, { ok: true })
}

export async function billing(res, user, { unigate, store, settings }, page) {
  const access = await unigate.accessFor(store, user)
  const [me, usage, stats] = await Promise.all([
    unigate.account('/me', access),
    unigate.account(`/usage?page=${page}&page_size=20`, access),
    unigate.account(`/usage/stats?start_date=${new Date().toISOString().slice(0, 7)}-01`, access),
  ])
  sendJson(res, 200, {
    balance: me.balance,
    frozenBalance: me.frozen_balance,
    usage: {
      page: usage.page,
      page_size: usage.page_size,
      total: usage.total,
      items: usage.items.map((row) => ({
        id: row.id,
        model: row.model,
        created_at: row.created_at,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_creation_tokens: row.cache_creation_tokens,
        cache_read_tokens: row.cache_read_tokens,
        actual_cost: row.actual_cost,
      })),
    },
    monthSpend: stats.total_actual_cost,
    rechargeUrl: `${settings.consoleUrl}/purchase`,
  })
}
