import {
  DotsThreeIcon,
  DownloadSimpleIcon,
  PencilSimpleIcon,
  PushPinIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import type { Conversation } from '../../../contract/types'
import { Popover } from '../../shared/ui/Popover'

export function ChatActions({
  conversation,
  onRename,
  onPin,
  onDelete,
}: {
  conversation: Conversation
  onRename: (title: string) => void
  onPin: () => void
  onDelete: () => void
}) {
  const { title, pinned, turns } = conversation
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'rename' | 'delete'>()
  const [name, setName] = useState(title)
  function download() {
    const content = [`# ${title}`, ...turns.flatMap((turn) => [turn.question, turn.answer])].join(
      '\n\n'
    )
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${title}.md`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setOpen(false)
  }
  function dismiss() {
    setOpen(false)
    setMode(undefined)
  }
  return (
    <div className="cv-actions">
      <button
        className="qx-btn qx-btn--ghost qx-btn--icon"
        type="button"
        aria-label={`${title}的更多操作`}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            dismiss()
          } else {
            setOpen(true)
          }
        }}
      >
        <DotsThreeIcon weight="bold" />
      </button>
      <Popover open={open} onClose={dismiss} className="cv-actions__menu" label="对话操作">
        {mode === 'rename' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onRename(name)
              dismiss()
            }}
          >
            <input
              className="qx-input"
              aria-label="新标题"
              autoFocus
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className="qx-btn qx-btn--primary" type="submit" disabled={!name.trim()}>
              保存
            </button>
          </form>
        ) : mode === 'delete' ? (
          <>
            <p className="qx-meta">删除「{title}」？</p>
            <button className="qx-item xb-danger-item" type="button" onClick={onDelete}>
              确认删除
            </button>
            <button className="qx-item" type="button" onClick={() => setMode(undefined)}>
              取消
            </button>
          </>
        ) : (
          <>
            <button
              className="qx-item"
              type="button"
              onClick={() => {
                onPin()
                dismiss()
              }}
            >
              <PushPinIcon />
              {pinned ? '取消置顶' : '置顶'}
            </button>
            <button
              className="qx-item"
              type="button"
              onClick={() => {
                setName(title)
                setMode('rename')
              }}
            >
              <PencilSimpleIcon />
              重命名
            </button>
            <button className="qx-item" type="button" onClick={download}>
              <DownloadSimpleIcon />
              导出为 Markdown
            </button>
            <div className="qx-menu__divider" />
            <button
              className="qx-item xb-danger-item"
              type="button"
              onClick={() => setMode('delete')}
            >
              <TrashIcon />
              删除对话
            </button>
          </>
        )}
      </Popover>
    </div>
  )
}
