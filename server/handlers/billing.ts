import type { Billing } from '../../contract/types.ts'
import { sendJson } from '../http.ts'
import type { AuthenticatedRequest, UniGateAccount } from '../types.ts'

export async function billing({ res, url, user, services }: AuthenticatedRequest) {
  const { unigate, store, settings } = services
  const page = Math.max(1, Math.min(1000, Math.trunc(Number(url.searchParams.get('page')) || 1)))
  const access = await unigate.accessFor(store, user)
  const [me, usage, stats] = await Promise.all([
    unigate.account<UniGateAccount>('/me', access),
    unigate.account<Billing['usage']>(`/usage?page=${page}&page_size=20`, access),
    unigate.account<{ total_actual_cost: number }>(
      `/usage/stats?start_date=${new Date().toISOString().slice(0, 7)}-01`,
      access
    ),
  ])
  const result: Billing = {
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
  }
  sendJson(res, 200, result)
}
