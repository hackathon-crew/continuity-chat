import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

const MAX_ATTACHMENTS = 8

export function useComposer(ready: boolean, onSend: (text: string, files: File[]) => void) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [toolsOpen, setToolsOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function send() {
    const text = value.trim()
    if (!text || !ready) {
      return
    }
    onSend(text, files)
    setFiles([])
    setValue('')
  }

  return {
    setValue,
    focus: () => inputRef.current?.focus(),
    closeTools: () => setToolsOpen(false),
    openFilePicker: () => {
      setToolsOpen(false)
      fileRef.current?.click()
    },
    props: {
      value,
      canSend: ready && Boolean(value.trim()),
      toolsOpen,
      inputRef,
      toolsRef,
      toolsButtonRef,
      fileRef,
      attachments: files.map((file, index) => ({
        id: String(index),
        title: file.name,
        status: '就绪',
        removable: true,
      })),
      onChange: setValue,
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          send()
        }
      },
      onSubmit: (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        send()
      },
      onToggleTools: () => setToolsOpen((open) => !open),
      onUpload: (added: File[]) =>
        setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS)),
      onRemoveAttachment: (id: string) =>
        setFiles((current) => current.filter((_, index) => String(index) !== id)),
    },
  }
}
