import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Octopus } from '../inkpaw/Octopus'

export function LoginPage({ onSignIn }: { onSignIn: () => void }) {
  const [busy, setBusy] = useState(false)
  return <section className="xb-login">
    <div className="xb-login__card">
      <Octopus size={144} res={72} mood="happy" label="Unigate Chat" />
      <h1 className="qx-section-title">登录 Unigate Chat</h1>
      <p className="xb-login__lede">用 UniGate 账号登录。余额、用量和充值和 UniGate 共用，不用再填 API Key。</p>
      <button type="button" className="qx-btn qx-btn--primary qx-btn--lg qx-btn--block" disabled={busy} onClick={() => { setBusy(true); window.setTimeout(onSignIn, 700) }}>{busy ? '正在跳转到 UniGate…' : '使用 UniGate 账号登录'}</button>
      <a className="qx-btn qx-btn--ghost" href="https://unigate.top" target="_blank" rel="noreferrer">还没有 UniGate 账号？去注册<ArrowSquareOutIcon aria-hidden="true" /></a>
    </div>
  </section>
}
