import { useState, type FormEvent } from 'react'
import { api, jsonBody, type PlatformUser } from '../../services/platform.js'
import { Button } from '../base/Button.js'
import styles from './Platform.module.css'

export const AuthScreen = ({
  onAuthenticated,
}: {
  onAuthenticated: (user: PlatformUser) => void
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const authenticate = async (path: string, body?: object) => {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ user: PlatformUser }>(path, {
        method: 'POST',
        ...(body ? { body: jsonBody(body) } : {}),
      })
      onAuthenticated(result.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void authenticate(`/api/auth/${mode}`, {
      email,
      password,
      ...(mode === 'register' ? { name } : {}),
    })
  }

  return (
    <div className={styles.authPage}>
      <section className={styles.authStory}>
        <div className={styles.authBrand}>续伴 · Continuity</div>
        <div>
          <h1 className={styles.authHeadline}>
            换一个地方，
            <br />
            <em>不必重新认识。</em>
          </h1>
          <p className={styles.authLead}>
            导入 DeepSeek
            历史，让原来的角色、关系和故事继续。没有每日聊天条数限制，也没有“几天没聊就失联”。
          </p>
          <div className={styles.authProof}>
            <span>DeepSeek 原会话导入</span>
            <span>可编辑 Soul & Memory</span>
            <span>独立 Personal Agent</span>
          </div>
        </div>
        <div className={styles.authFootnote}>
          基于 DeepSeek API 与开源 Chat Demo · 非 DeepSeek 官方产品
        </div>
      </section>
      <section className={styles.authFormSide}>
        <form className={styles.authForm} onSubmit={submit}>
          <h1>{mode === 'login' ? '欢迎回来' : '创建你的空间'}</h1>
          <p className={styles.authMuted}>
            {mode === 'login'
              ? '登录后，继续那些还没有结束的对话。'
              : '只需邮箱和密码，即可开始第一轮体验。'}
          </p>
          {mode === 'register' ? (
            <div className={styles.field}>
              <label htmlFor="auth-name">希望我们怎么称呼你</label>
              <input
                id="auth-name"
                className={styles.input}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="nickname"
              />
            </div>
          ) : null}
          <div className={styles.field}>
            <label htmlFor="auth-email">邮箱</label>
            <input
              id="auth-email"
              className={styles.input}
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="auth-password">密码</label>
            <input
              id="auth-password"
              className={styles.input}
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="至少 8 位"
            />
          </div>
          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : null}
          <Button type="submit" block disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '登录并继续' : '注册并开始'}
          </Button>
          <Button
            variant="outlined"
            className={styles.demoButton}
            disabled={busy}
            onClick={() => void authenticate('/api/auth/demo')}
          >
            直接进入产品 Demo
          </Button>
          <div className={styles.authSwitch}>
            {mode === 'login' ? '还没有账户？' : '已经有账户？'}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError('')
              }}
            >
              {mode === 'login' ? '立即注册' : '返回登录'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
