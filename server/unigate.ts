import { HttpError } from './http.ts'

const clientId = 'unigate-chat'
const oauthPath = '/api/v1/oauth/unigate-chat'
const managementTimeoutMs = 15_000
const tokenRefreshWindowMs = 30_000

export class UniGateClient {
  constructor(settings) {
    this.settings = settings
  }

  get redirectUri() {
    return `${this.settings.publicUrl}/api/auth/callback`
  }

  authorizeUrl(state, challenge) {
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    return `${this.settings.consoleUrl}/oauth/authorize?${query}`
  }

  exchange(code, verifier) {
    return this.token({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: this.redirectUri,
    })
  }

  async token(values) {
    const auth = Buffer.from(`${clientId}:${this.settings.oauthSecret}`).toString('base64')
    const res = await fetch(`${this.settings.apiUrl}${oauthPath}/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      body: new URLSearchParams(values),
      redirect: 'error',
      signal: AbortSignal.timeout(managementTimeoutMs),
    })
    if (res.status === 400) {
      throw new HttpError(401, '请从 Unigate Chat 重新登录', 'authorization_expired')
    }
    if (!res.ok) {
      throw new HttpError(502, 'UniGate 授权服务暂不可用', 'unigate_unavailable')
    }
    const data = await res.json()
    return {
      access: data.access_token,
      refresh: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    }
  }

  async account(path, access, method = 'GET') {
    const res = await fetch(`${this.settings.apiUrl}${oauthPath}${path}`, {
      method,
      headers: { Authorization: `Bearer ${access}` },
      redirect: 'error',
      signal: AbortSignal.timeout(managementTimeoutMs),
    })
    if (res.status === 401) {
      throw new HttpError(401, '请从 Unigate Chat 重新登录', 'authorization_expired')
    }
    if (res.status === 403) {
      throw new HttpError(403, '当前 UniGate 账户未开通此权限', 'unigate_forbidden')
    }
    if (!res.ok) {
      throw new HttpError(502, 'UniGate 无法完成账户请求', 'unigate_unavailable')
    }
    return (await res.json()).data
  }

  model(path, key, { method = 'GET', body, signal } = {}) {
    return fetch(`${this.settings.gatewayUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
      redirect: 'error',
      signal,
    })
  }

  async accessFor(store, user) {
    if (user.oauth_expires_at > Date.now() + tokenRefreshWindowMs) {
      return store.secret(user, 'oauth_access')
    }
    return store.transaction(async (db) => {
      const current = await store.user(user.id, db, true)
      if (current.oauth_expires_at > Date.now() + tokenRefreshWindowMs) {
        return store.secret(current, 'oauth_access')
      }
      const tokens = await this.token({
        grant_type: 'refresh_token',
        refresh_token: store.secret(current, 'oauth_refresh'),
      })
      await store.updateTokens(db, current.id, tokens)
      return tokens.access
    })
  }
}
