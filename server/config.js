import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const config = {
  root,
  port: Number(process.env.PORT ?? 3080),
  dataDir: process.env.DATA_DIR ?? path.join(root, 'data'),
  deepseekApiBase: (process.env.DEEPSEEK_API_BASE ?? 'https://api.deepseek.com').replace(/\/$/, ''),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  appSecret: process.env.APP_SECRET ?? '',
  publicUrl: (
    process.env.PUBLIC_URL ?? `http://localhost:${Number(process.env.PORT ?? 3080)}`
  ).replace(/\/$/, ''),
  demoMode: process.env.DEMO_MODE !== 'false',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  stripePrices: {
    plus: process.env.STRIPE_PLUS_PRICE_ID ?? '',
    pro: process.env.STRIPE_PRO_PRICE_ID ?? '',
  },
}
