import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Billing, Model, User } from '../../contract/types'
import { ApiError, json, listModels } from '../shared/api'

const authMessages: Record<string, string> = {
  denied: '授权已取消。你可以重新发起登录。',
  expired: '登录请求已过期。请重新发起登录。',
  permission: '这个 UniGate 账号暂未开通聊天权限。',
  unavailable: 'UniGate 授权未完成。请确认你能打开 UniGate 控制台后重新登录。',
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成'
}

function useSessionState() {
  const [user, setUser] = useState<User | null | undefined>()
  const [billing, setBilling] = useState<Billing>()
  const [models, setModels] = useState<Model[]>([])
  const [error, setError] = useState(
    () => authMessages[new URLSearchParams(location.search).get('auth') ?? '']
  )

  const refreshBilling = useCallback(async (page = 1) => {
    try {
      setBilling(await json<Billing>(`/api/billing?page=${page}`))
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setUser(null)
      }
      setError(errorText(failure))
    }
  }, [])

  const loadSession = useCallback(
    (loadList: () => Promise<void>) => {
      let done = false
      void json<User>('/api/auth/me').then(
        (current) => {
          if (done) {
            return
          }
          setUser(current)
          void loadList().catch((failure) => setError(errorText(failure)))
          void listModels().then(setModels, (failure) => setError(errorText(failure)))
          void refreshBilling()
        },
        (failure) => {
          if (!done) {
            setUser(null)
            if (!(failure instanceof ApiError && failure.status === 401)) {
              setError(errorText(failure))
            }
          }
        }
      )
      return () => {
        done = true
      }
    },
    [refreshBilling]
  )

  async function signOut(resetWorkspace: () => void) {
    await json('/api/auth/logout', 'POST')
    resetWorkspace()
    setUser(null)
    setBilling(undefined)
    setModels([])
  }

  return { user, billing, models, error, setError, refreshBilling, loadSession, signOut }
}

const SessionContext = createContext<ReturnType<typeof useSessionState> | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  return <SessionContext.Provider value={useSessionState()}>{children}</SessionContext.Provider>
}

export function useSession() {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error('useSession requires SessionProvider')
  }
  return session
}
