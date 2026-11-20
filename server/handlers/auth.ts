import type { User } from '../../contract/types.ts'
import type { AuthenticatedRequest, RouteRequest, UniGateAccount, UserRow } from '../types.ts'
import { cookie, cookieValue, HttpError, redirect, sendJson } from '../http.ts'
import { createToken, hashToken } from '../security.ts'
import { addLogin, consumeLogin, endSession, loginLifetime, sessionLifetime } from '../db/users.ts'
import { startSession } from '../services/session.ts'

const loginCookie = 'continuity_oauth'
const sessionCookie = 'continuity_session'

const publicUser = (user: UserRow): User => ({
  id: String(user.id),
  name: user.name,
  account: user.email,
})

export async function startLogin({ res, services }: RouteRequest) {
  const { store, unigate, settings } = services
  const state = createToken()
  const verifier = createToken()
  const browser = createToken()
  await addLogin(store.db, hashToken(state), hashToken(browser), verifier)
  return redirect(res, unigate.authorizeUrl(state, hashToken(verifier)), [
    cookie(settings, loginCookie, browser, loginLifetime),
  ])
}

export async function finishLogin({ req, res, url, services }: RouteRequest) {
  const { store, unigate, settings } = services
  const clear = cookie(settings, loginCookie, '', 0)
  const state = url.searchParams.get('state')
  const browser = cookieValue(req, loginCookie)
  if (!state || !browser) {
    return redirect(res, '/?auth=expired', [clear])
  }
  const attempt = await consumeLogin(store.db, hashToken(state), hashToken(browser))
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
    const me = await unigate.account<UniGateAccount>('/me', tokens.access)
    const { key } = await unigate.account<{ key: string }>('/key', tokens.access, 'POST')
    const token = createToken()
    await startSession(store, me, key, tokens, hashToken(token))
    const oldToken = cookieValue(req, sessionCookie)
    if (oldToken) {
      await endSession(store.db, hashToken(oldToken))
    }
    return redirect(res, '/', [clear, cookie(settings, sessionCookie, token, sessionLifetime)])
  } catch (error) {
    if (!(error instanceof HttpError)) {
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`)
    }
    const status =
      (error as { code?: string }).code === 'unigate_forbidden' ? 'permission' : 'unavailable'
    return redirect(res, `/?auth=${status}`, [clear])
  }
}

export async function logout({ req, res, services }: RouteRequest) {
  const { store, settings } = services
  const token = cookieValue(req, sessionCookie)
  if (token) {
    await endSession(store.db, hashToken(token))
  }
  res.setHeader('Set-Cookie', cookie(settings, sessionCookie, '', 0))
  sendJson(res, 200, { ok: true })
}

export function getUser({ res, user }: AuthenticatedRequest) {
  return sendJson(res, 200, publicUser(user))
}
