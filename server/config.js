import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 3080)
const withoutSlash = (url) => url.replace(/\/$/, '')
const consoleUrl = withoutSlash(process.env.UNIGATE_CONSOLE_URL ?? 'https://unigate.top')

export const config = {
  root,
  port,
  host: process.env.HOST ?? '127.0.0.1',
  publicUrl: withoutSlash(process.env.PUBLIC_URL ?? `http://localhost:${port}`),
  consoleUrl,
  apiUrl: withoutSlash(process.env.UNIGATE_API_URL ?? consoleUrl),
  gatewayUrl: withoutSlash(process.env.UNIGATE_GATEWAY_URL ?? 'https://unigate.top/v1'),
  oauthSecret: process.env.UNIGATE_OAUTH_CLIENT_SECRET ?? '',
  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? '',
  databaseUrl: process.env.DATABASE_URL,
  tavilyKey: process.env.TAVILY_API_KEY ?? '',
}

export function validateConfig(settings) {
  if (!settings.databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }
  if (settings.oauthSecret.length < 32) {
    throw new Error('UNIGATE_OAUTH_CLIENT_SECRET must have at least 32 characters')
  }
  if (!/^[0-9a-f]{64}$/i.test(settings.encryptionKey)) {
    throw new Error('APP_ENCRYPTION_KEY must be 32 bytes encoded as hex')
  }
  for (const key of ['publicUrl', 'consoleUrl', 'apiUrl', 'gatewayUrl']) {
    const url = new URL(settings[key])
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    ) {
      throw new Error(`${key} must use HTTPS or a local HTTP address`)
    }
  }
}
