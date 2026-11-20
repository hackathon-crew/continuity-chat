import type { IncomingMessage, ServerResponse } from 'node:http'
import * as agent from './handlers/agent.ts'
import { finishLogin, getUser, logout, startLogin } from './handlers/auth.ts'
import { billing } from './handlers/billing.ts'
import * as chats from './handlers/conversations.ts'
import { proxyModel } from './handlers/proxy.ts'
import { checkSameOrigin, HttpError, matchRoute, requireUser, sendJson } from './http.ts'
import type { AuthenticatedRequest, RouteRequest, Services } from './types.ts'

type Handler<T> = (request: T) => void | Promise<void>
type Route = { method: string; path: string } & (
  | { public: true; handle: Handler<RouteRequest> }
  | { public?: false; handle: Handler<AuthenticatedRequest> }
)

function health({ res }: RouteRequest) {
  return sendJson(res, 200, { ok: true })
}

const routes: readonly Route[] = [
  { method: 'GET', path: '/api/health', public: true, handle: health },
  { method: 'GET', path: '/api/auth/login', public: true, handle: startLogin },
  { method: 'GET', path: '/api/auth/callback', public: true, handle: finishLogin },
  { method: 'POST', path: '/api/auth/logout', public: true, handle: logout },
  { method: 'GET', path: '/api/auth/me', handle: getUser },
  { method: 'GET', path: '/api/billing', handle: billing },

  { method: 'GET', path: '/api/conversations', handle: chats.listChats },
  { method: 'POST', path: '/api/conversations', handle: chats.createChat },
  { method: 'POST', path: '/api/conversations/import', handle: chats.importChat },
  { method: 'GET', path: '/api/conversations/:id', handle: chats.getChat },
  { method: 'PATCH', path: '/api/conversations/:id', handle: chats.editChat },
  { method: 'DELETE', path: '/api/conversations/:id', handle: chats.deleteChat },
  { method: 'POST', path: '/api/conversations/:id/turns', handle: chats.streamTurn },
  { method: 'GET', path: '/api/conversations/:id/files/:fileId', handle: chats.downloadChatFile },

  { method: 'GET', path: '/api/agent', handle: agent.getAgent },
  { method: 'POST', path: '/api/agent/messages', handle: agent.sendMessage },
  { method: 'PATCH', path: '/api/agent/profile', handle: agent.editProfile },
  { method: 'POST', path: '/api/agent/memories', handle: agent.addMemory },
  { method: 'PATCH', path: '/api/agent/memories/:id', handle: agent.editMemory },
  { method: 'DELETE', path: '/api/agent/memories/:id', handle: agent.removeMemory },
  { method: 'POST', path: '/api/agent/mcp', handle: agent.addMcp },
  { method: 'DELETE', path: '/api/agent/mcp/:id', handle: agent.removeMcp },
  { method: 'GET', path: '/api/agent/files/:id', handle: agent.downloadAgentFile },
  { method: 'PATCH', path: '/api/agent/reminders/:id', handle: agent.editReminder },

  { method: 'GET', path: '/v1/models', handle: proxyModel },
  { method: 'POST', path: '/v1/chat/completions', handle: proxyModel },
]

export async function routeApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  services: Services
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    checkSameOrigin(req, services.settings)
  }
  const match = matchRoute(routes, req.method, url.pathname)
  const request = { req, res, url, services, params: match?.params ?? {} }
  if (match?.route.public) {
    return match.route.handle(request)
  }

  const user = await requireUser(req, services.store.db)
  if (!match) {
    const message = url.pathname.startsWith('/v1/') ? '模型接口不存在' : '请求的接口不存在'
    throw new HttpError(404, message, 'not_found')
  }
  return match.route.handle({ ...request, user })
}
