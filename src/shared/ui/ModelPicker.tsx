import { CaretDownIcon, CheckIcon, CpuIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import type { Model, ModelProvider } from '../../../contract/types'
import deepseekMark from '../../vendor/everplain/assets/models/deepseek.svg'
import chatgptMark from '../../vendor/everplain/assets/models/chatgpt.svg'
import { Popover } from './Popover'

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
