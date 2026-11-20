import { XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { useAnimatedDismiss } from '../../ui/usePresence'
import './settings-modal.css'

/** Native focus boundary around the Mock's header-and-content dialog surface. */
export function SettingsModal({ children, onClose, identity, accountName, label }: {
  children: ReactNode
  onClose(): void
  identity?: ReactNode
  accountName?: string
  label?: string
}) {
  const boundary = useRef<HTMLDialogElement>(null)
  const motion = useAnimatedDismiss(boundary, onClose)
  const { text } = useAppLocale()
  useEffect(() => {
    const dialog = boundary.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    dialog?.showModal()
    dialog?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  function dismiss() {
    if (!boundary.current?.querySelector('[role="dialog"][aria-modal="true"]')) motion.dismiss()
  }

  return <dialog
    className="ep-settings-dialog" data-motion-surface="modal" {...motion.props}
    ref={boundary}
    tabIndex={-1}
    aria-label={label ?? text('账户设置', 'Account settings')}
    onCancel={event => { event.preventDefault(); dismiss() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dismiss()
    }}
  >
    <div className="qx-modal ep-settings-dialog__surface">
      <header className="ep-settings-dialog__heading">
        {identity ?? <span className="qx-heading">{accountName || text('账户', 'Account')}</span>}
        <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label={text('关闭账户设置', 'Close account settings')} onClick={dismiss}><XIcon aria-hidden="true" /></button>
      </header>
      <div className="ep-settings-dialog__content">{children}</div>
    </div>
  </dialog>
}
