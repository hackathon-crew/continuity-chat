import { useRef, useState } from 'react'
import { create } from 'zustand'
import { importHistory } from '../../services/chat/backup.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './Platform.module.css'

const useMigration = create<{ open: boolean }>(() => ({ open: false }))
export const openMigration = () => useMigration.setState({ open: true })
export const closeMigration = () => useMigration.setState({ open: false })

export const MigrationDialog = ({ userId }: { userId: string }) => {
  const open = useMigration((state) => state.open)
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const count = useChatStore((state) => state.sessions.length)

  const close = () => {
    if (busy) {
      return
    }
    localStorage.setItem(`continuity:onboarded:${userId}`, 'true')
    setFile(null)
    setError('')
    closeMigration()
  }

  const runImport = async () => {
    if (!file) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const imported = await importHistory(file)
      const first = useChatStore.getState().sessions[0]
      if (first) {
        selectSession(first.id)
      }
      localStorage.setItem(`continuity:onboarded:${userId}`, 'true')
      showToast({ key: 'historyImported', params: { count: imported } })
      setFile(null)
      closeMigration()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '导入失败，请确认这是 DeepSeek 导出的 ZIP 文件'
      )
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return null
  }
  return (
    <Modal title="欢迎来到续伴" className={styles.migration} closable onClose={close}>
      <div className={styles.migrationHero}>
        <h2 className={styles.migrationTitle}>
          原来的 TA，
          <br />
          接着上次聊下去。
        </h2>
        <div>选择 DeepSeek 导出的历史 ZIP。消息、当前分支和图片会恢复到本机，打开后即可继续。</div>
        <ol className={styles.migrationSteps}>
          <li>在 DeepSeek 中导出历史记录</li>
          <li>选择 `deepseek_data-日期.zip`</li>
          <li>打开最近会话，直接发送下一句话</li>
        </ol>
      </div>
      {count ? (
        <p className={styles.status}>
          当前已有 {count} 个会话。导入会替换本机现有记录，请先在设置 → 数据管理中备份。
        </p>
      ) : null}
      {file ? (
        <p className={styles.status}>
          已选择：{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）
        </p>
      ) : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".zip,application/zip,application/x-zip-compressed"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null)
          event.target.value = ''
        }}
      />
      <div className={styles.actions}>
        <Button
          size="m"
          disabled={busy}
          onClick={() => (file ? void runImport() : inputRef.current?.click())}
        >
          {busy ? '正在恢复对话…' : file ? '确认导入并续聊' : '选择 DeepSeek 导出文件'}
        </Button>
        <Button variant="outlined" size="m" disabled={busy} onClick={close}>
          先开始新对话
        </Button>
      </div>
    </Modal>
  )
}
