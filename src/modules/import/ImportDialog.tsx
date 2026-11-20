import { CheckCircleIcon, CheckIcon, FileZipIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { SettingsModal } from '../../vendor/everplain/app/ui/SettingsModal'
import '../../vendor/everplain/app/ui/settings-modal.css'
import { legacyDatabases, readLegacyDatabase } from './deepseek/db'
import type { ConversationSummary } from '../../../contract/types'
import { displayDate } from '../../shared/displayDate'
import { readDeepSeekArchive, saveImportedConversation } from './historyImport'

type Stage = Awaited<ReturnType<typeof readDeepSeekArchive>>
type Step = 'pick' | 'select' | 'importing' | 'done'

export function ImportDialog({
  userId,
  model,
  onClose,
  onImported,
}: {
  userId: string
  model: string
  onClose: () => void
  onImported: (rows: ConversationSummary[]) => void
}) {
  const [step, setStep] = useState<Step>('pick')
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [stage, setStage] = useState<Stage>()
  const [source, setSource] = useState<'deepseek' | 'legacy'>('deepseek')
  const [legacyName, setLegacyName] = useState('')
  const [oldDatabases, setOldDatabases] = useState<string[]>([])
  const [filename, setFilename] = useState('')
  const [progress, setProgress] = useState(0)
  const [saved, setSaved] = useState<ConversationSummary[]>([])
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const migrationKey = `unigate-imported-local:${userId}`
  const sessions = [...(stage?.sessions.values() ?? [])]
  const chosen = sessions.filter((item) => selected.has(item.id))

  useEffect(() => {
    if (typeof indexedDB.databases === 'function') {
      void legacyDatabases().then((names) =>
        setOldDatabases(names.filter((name) => !localStorage.getItem(`${migrationKey}:${name}`)))
      )
    }
  }, [migrationKey])

  async function prepare(kind: 'deepseek' | 'legacy', name: string, load: () => Promise<Stage>) {
    setReading(true)
    setError('')
    try {
      const data = await load()
      if (!data.sessions.size) {
        throw new Error('这份记录里没有可导入的对话')
      }
      setSource(kind)
      setFilename(name)
      setStage(data)
      setSelected(new Set(data.sessions.keys()))
      setStep('select')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '无法读取记录')
    } finally {
      setReading(false)
    }
  }

  function pick(file?: File) {
    if (file && !reading) {
      void prepare('deepseek', file.name, () => readDeepSeekArchive(file))
    }
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  async function run() {
    if (!stage) {
      return
    }
    setError('')
    setProgress(0)
    setStep('importing')
    const imported: ConversationSummary[] = []
    try {
      for (const item of chosen) {
        imported.push(await saveImportedConversation(source, item, stage.files, model))
        setProgress(imported.length)
      }
      if (source === 'legacy' && chosen.length === sessions.length) {
        localStorage.setItem(`${migrationKey}:${legacyName}`, '1')
      }
      setSaved(imported)
      setStep('done')
    } catch (failure) {
      setError(
        `已保存 ${imported.length} 个对话。${failure instanceof Error ? failure.message : '剩余对话未导入'}`
      )
      setStep('select')
    }
  }

  function close() {
    if (step === 'done') {
      onImported(saved)
    } else if (step !== 'importing') {
      onClose()
    }
  }

  return (
    <SettingsModal onClose={close} label="导入 DeepSeek 记录" accountName="导入 DeepSeek 记录">
      <div className="xb-import">
        {error ? (
          <p className="qx-meta" role="alert">
            {error}
          </p>
        ) : null}
        {step === 'pick' ? (
          <>
            <label
              className="xb-drop"
              data-dragging={dragging || undefined}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                pick(event.dataTransfer.files[0])
              }}
            >
              <UploadSimpleIcon className="xb-drop__icon" aria-hidden="true" />
              <strong>把 DeepSeek 导出的 ZIP 拖到这里</strong>
              <span className="qx-meta">原来的对话、分支和时间都会保留，导入后可以直接接着聊</span>
              <span className="qx-btn qx-btn--secondary">{reading ? '正在读取…' : '选择文件'}</span>
              <input
                type="file"
                accept=".zip"
                hidden
                disabled={reading}
                onChange={(event) => {
                  pick(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
            <ol className="xb-import__how">
              <li>在 DeepSeek 网页版打开设置，找到数据管理</li>
              <li>导出全部对话，会得到一个 ZIP 文件</li>
              <li>把这个 ZIP 拖进上面的框里</li>
            </ol>
            {oldDatabases.map((name, index) => (
              <button
                className="qx-btn qx-btn--secondary"
                type="button"
                key={name}
                disabled={reading}
                onClick={() => {
                  setLegacyName(name)
                  void prepare('legacy', `本机旧对话 ${index + 1}`, () => readLegacyDatabase(name))
                }}
              >
                导入本机旧对话{oldDatabases.length > 1 ? ` ${index + 1}` : ''}
              </button>
            ))}
          </>
        ) : null}

        {step === 'select' ? (
          <>
            <div className="xb-import__head">
              <span className="xb-import__file">
                <FileZipIcon aria-hidden="true" />
                {filename}
              </span>
              <button
                type="button"
                className="qx-btn qx-btn--ghost"
                onClick={() =>
                  setSelected(
                    selected.size === sessions.length
                      ? new Set()
                      : new Set(sessions.map((item) => item.id))
                  )
                }
              >
                {selected.size === sessions.length ? '全不选' : '全选'}
              </button>
            </div>
            <div className="xb-import__list" role="group" aria-label="选择要导入的对话">
              {sessions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="qx-item xb-import__item"
                  role="checkbox"
                  aria-checked={selected.has(item.id)}
                  onClick={() => toggle(item.id)}
                >
                  <span className="xb-check" data-checked={selected.has(item.id) || undefined}>
                    {selected.has(item.id) ? <CheckIcon weight="bold" /> : null}
                  </span>
                  <span className="xb-import__title">{item.title}</span>
                  <span className="qx-item__trail">
                    {item.messages.length} 条 · {displayDate(item.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
            <div className="xb-import__foot">
              <span className="qx-meta">
                共 {sessions.length} 个对话，已选 {selected.size} 个
              </span>
              <button
                type="button"
                className="qx-btn qx-btn--primary"
                disabled={!selected.size}
                onClick={() => void run()}
              >
                导入 {selected.size} 个对话
              </button>
            </div>
          </>
        ) : null}

        {step === 'importing' ? (
          <div className="xb-import__state" role="status">
            <progress className="cv-research-flow__progress" max={chosen.length} value={progress} />
            <strong>正在导入「{chosen[Math.min(progress, chosen.length - 1)]?.title}」</strong>
            <span className="qx-meta">
              {progress} / {chosen.length}
            </span>
          </div>
        ) : null}

        {step === 'done' ? (
          <div className="xb-import__state">
            <CheckCircleIcon className="xb-import__done" aria-hidden="true" />
            <strong>导入了 {saved.length} 个对话</strong>
            <button type="button" className="qx-btn qx-btn--primary" onClick={close}>
              去看看
            </button>
          </div>
        ) : null}
      </div>
    </SettingsModal>
  )
}
