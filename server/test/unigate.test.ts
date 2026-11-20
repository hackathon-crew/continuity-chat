import type { AddressInfo } from 'node:net'
import type { Billing, UsageRow } from '../../contract/types.ts'
import { config } from '../config.ts'
import type { Services, UserRow } from '../types.ts'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'

test('UniGate requests use only the selected user key and preserve streaming frames', async (t) => {
  const { UniGateClient } = await import('../services/unigate.ts')
  const seen: { auth?: string; path?: string }[] = []
  const upstream = createServer((req, res) => {
    seen.push({ auth: req.headers.authorization, path: req.url })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('data: {"choices":[{"delta":{"content":"ready"}}]}\n\n')
    res.end('data: [DONE]\n\n')
  }).listen(0, '127.0.0.1')
  t.after(() => upstream.close())
  await once(upstream, 'listening')
  const client = new UniGateClient({
    ...config,
    gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
  })
  const res = await client.model('/chat/completions', 'first-user', {
    method: 'POST',
    body: JSON.stringify({ model: 'test-model', messages: [], stream: true }),
  })
  assert.match(await res.text(), /ready[\s\S]+\[DONE\]/)
  await (await client.model('/models', 'second-user')).text()
  assert.deepEqual(seen, [
    { auth: 'Bearer first-user', path: '/v1/chat/completions' },
    { auth: 'Bearer second-user', path: '/v1/models' },
  ])
})

test('billing responses expose usage numbers without API credentials', async (t) => {
  const { billing } = await import('../handlers/billing.ts')
  const raw = {
    '/me': { balance: 9.5, frozen_balance: 1 },
    '/usage': {
      page: 1,
      page_size: 20,
      total: 1,
      items: [
        {
          id: 6,
          model: 'test-model',
          actual_cost: 0.5,
          api_key: { key: 'upstream-private' },
          input_tokens: 100,
          output_tokens: 10,
          created_at: '2026-11-20T02:00:00Z',
        },
      ],
    },
    '/usage/stats': { total_actual_cost: 0.5 },
  }
  const upstream = createServer((req, res) => {
    void billing({
      req,
      res,
      url: new URL('/', 'http://127.0.0.1'),
      params: {},
      user: { id: '1' } as UserRow,
      services: {
        unigate: {
          accessFor: async () => 'upstream-access-token',
          account: async (path: string) => raw[path.split('?')[0] as keyof typeof raw],
        },
        store: null,
        settings: { consoleUrl: 'https://unigate.example' },
      } as unknown as Services,
    })
  }).listen(0, '127.0.0.1')
  t.after(() => upstream.close())
  await once(upstream, 'listening')
  const res = await fetch(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`)
  const data = (await res.json()) as Billing
  assert.equal(data.monthSpend, 0.5)
  assert.equal(data.usage.items[0].actual_cost, 0.5)
  assert.equal((data.usage.items[0] as UsageRow & { api_key?: unknown }).api_key, undefined)
})
