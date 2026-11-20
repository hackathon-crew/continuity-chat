import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { usePresence } from '../../vendor/everplain/ui/usePresence'

/** Everplain 的 popover 进出：usePresence + data-motion-surface，点外面或 Esc 关闭。 */
export function Popover({
  open,
  onClose,
  className,
  label,
  anchor,
  children,
}: {
  open: boolean
  onClose: () => void
  className: string
  label: string
  anchor?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const motion = usePresence(open, ref)
  // 输入框所在的停靠区会裁切溢出，带 anchor 的菜单照 Everplain 的 + 号菜单进顶层，按触发按钮定位。
  useLayoutEffect(() => {
    const menu = ref.current
    if (!anchor || !motion.present || !menu) {
      return
    }
    menu.showPopover?.()
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      const width = window.visualViewport?.width ?? window.innerWidth
      const left = Math.max(
        16,
        Math.min(rect.right - menu.offsetWidth, width - menu.offsetWidth - 16)
      )
      const above = rect.top - menu.offsetHeight - 8
      menu.style.left = `${left}px`
      menu.style.top = `${above >= 8 ? above : rect.bottom + 8}px`
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, motion.present])
  useEffect(() => {
    if (!open) {
      return
    }
    const down = (event: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) {
        onClose()
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, onClose])
  return motion.present ? (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`qx-menu ${className}`}
      data-motion-surface="popover"
      popover={anchor ? 'manual' : undefined}
      {...motion.props}
    >
      {children}
    </div>
  ) : null
}
