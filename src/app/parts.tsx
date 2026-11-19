import { CaretDownIcon, CheckIcon, CpuIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import ReactMarkdown, { type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import deepseekMark from '../everplain/assets/models/deepseek.svg'
import chatgptMark from '../everplain/assets/models/chatgpt.svg'
import { rehypeStreamReveal } from '../everplain/app/agent/rehypeStreamReveal'
import type { StreamReveal } from '../everplain/app/agent/useStreamPacer'
import { usePresence } from '../everplain/ui/usePresence'
import octoMark from '../inkpaw/octo-mark.png'
import type { Model, ModelProvider } from './data'

export function ModelMark({ provider }: { provider: ModelProvider }) {
  return (
    <span className="xb-model-mark" aria-hidden="true">
      {provider === 'deepseek' ? (
        <img src={deepseekMark} alt="" />
      ) : provider === 'openai' ? (
        <i style={{ maskImage: `url(${chatgptMark})` }} />
      ) : (
        <CpuIcon />
      )}
    </span>
  )
}

export function BrandName() {
  return (
    <strong className="xb-brand" aria-label="Unigate Chat">
      <span aria-hidden="true">Unigate</span>
      <span className="xb-brand__chat" aria-hidden="true">
        chat
      </span>
    </strong>
  )
}

export function OctoMark({ size = 20 }: { size?: number }) {
  return (
    <img
      className="xb-octo-mark"
      src={octoMark}
      alt=""
      width={size}
      height={Math.round((size * 42) / 48)}
      aria-hidden="true"
    />
  )
}

export function Markdown({ text, reveal }: { text: string; reveal?: StreamReveal }) {
  const rehype = (
    reveal?.revealedAt.length ? [[rehypeStreamReveal, reveal]] : []
  ) as Options['rehypePlugins']
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehype}>
      {text}
    </ReactMarkdown>
  )
}

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

export function ModelPicker({
  value,
  onChange,
  balance,
  models,
}: {
  value: string
  onChange: (id: string) => void
  balance?: number
  models: Model[]
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = models.find((model) => model.id === value) ?? models[0]
  return (
    <div className="xb-picker">
      <button
        ref={trigger}
        type="button"
        className="qx-btn qx-btn--ghost xb-picker__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={!models.length}
        onClick={() => setOpen((value) => !value)}
      >
        <ModelMark provider={current?.provider ?? 'generic'} />
        <span>{current?.name ?? '暂无可用模型'}</span>
        <CaretDownIcon aria-hidden="true" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        className="xb-picker__menu"
        label="选择模型"
        anchor={trigger}
      >
        {models.map((model) => (
          <button
            key={model.id}
            type="button"
            role="menuitemradio"
            aria-checked={model.id === value}
            className="qx-item xb-picker__option"
            onClick={() => {
              onChange(model.id)
              setOpen(false)
            }}
          >
            <ModelMark provider={model.provider} />
            <span className="xb-picker__text">
              <strong>{model.name}</strong>
              <span className="qx-meta">{model.note}</span>
            </span>
            {model.id === value ? <CheckIcon aria-hidden="true" /> : null}
          </button>
        ))}
        <div className="qx-menu__divider" />
        <p className="qx-meta xb-picker__foot">
          按 UniGate 价格计费{balance === undefined ? '' : ` · 余额 ¥${balance.toFixed(2)}`}
        </p>
      </Popover>
    </div>
  )
}
