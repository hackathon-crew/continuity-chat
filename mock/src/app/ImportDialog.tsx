import { CheckCircleIcon, CheckIcon, FileZipIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { SettingsModal } from '../everplain/app/ui/SettingsModal'
import '../everplain/app/ui/settings-modal.css'
import { importCandidates } from './data'

type Step = 'pick' | 'select' | 'importing' | 'done'

export type ImportStep = Step

export function ImportDialog({ onClose, onImported, initialStep = 'pick' }: { onClose: () => void; onImported: (ids: string[]) => void; initialStep?: Step }) {
  const [step, setStep] = useState<Step>(initialStep)
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(importCandidates.slice(0, 4).map(item => item.id)))
  const [progress, setProgress] = useState(initialStep === 'done' ? 4 : 0)
  const chosen = importCandidates.filter(item => selected.has(item.id))

  useEffect(() => {
    if (step !== 'importing') return
    const timer = window.setInterval(() => setProgress(value => {
      if (value >= chosen.length) { window.clearInterval(timer); setStep('done'); return value }
      return value + 1
    }), 520)
    return () => window.clearInterval(timer)
  }, [step, chosen.length])

  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <SettingsModal onClose={onClose} label="导入 DeepSeek 记录" accountName="导入 DeepSeek 记录">
    <div className="xb-import">
      {step === 'pick' ? <>
        <label className="xb-drop" data-dragging={dragging || undefined}
          onDragOver={event => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); setStep('select') }}>
          <UploadSimpleIcon className="xb-drop__icon" aria-hidden="true" />
          <strong>把 DeepSeek 导出的 ZIP 拖到这里</strong>
          <span className="qx-meta">原来的对话、分支和时间都会保留，导入后可以直接接着聊</span>
          <span className="qx-btn qx-btn--secondary">选择文件</span>
          <input type="file" accept=".zip" hidden onChange={() => setStep('select')} />
        </label>
        <ol className="xb-import__how">
          <li>在 DeepSeek 网页版打开设置，找到数据管理</li>
          <li>导出全部对话，会得到一个 ZIP 文件</li>
          <li>把这个 ZIP 拖进上面的框里</li>
        </ol>
      </> : null}

      {step === 'select' ? <>
        <div className="xb-import__head">
          <span className="xb-import__file"><FileZipIcon aria-hidden="true" />deepseek_data_2026-11-19.zip</span>
          <button type="button" className="qx-btn qx-btn--ghost" onClick={() => setSelected(selected.size === importCandidates.length ? new Set() : new Set(importCandidates.map(item => item.id)))}>{selected.size === importCandidates.length ? '全不选' : '全选'}</button>
        </div>
        <div className="xb-import__list" role="group" aria-label="选择要导入的对话">
          {importCandidates.map(item => <button key={item.id} type="button" className="qx-item xb-import__item" role="checkbox" aria-checked={selected.has(item.id)} onClick={() => toggle(item.id)}>
            <span className="xb-check" data-checked={selected.has(item.id) || undefined}>{selected.has(item.id) ? <CheckIcon weight="bold" /> : null}</span>
            <span className="xb-import__title">{item.title}</span>
            <span className="qx-item__trail">{item.messages} 条 · {item.last}</span>
          </button>)}
        </div>
        <div className="xb-import__foot">
          <span className="qx-meta">共 {importCandidates.length} 个对话，已选 {selected.size} 个</span>
          <button type="button" className="qx-btn qx-btn--primary" disabled={!selected.size} onClick={() => { setProgress(0); setStep('importing') }}>导入 {selected.size} 个对话</button>
        </div>
      </> : null}

      {step === 'importing' ? <div className="xb-import__state" role="status">
        <progress className="cv-research-flow__progress" max={chosen.length} value={progress} />
        <strong>正在整理「{chosen[Math.min(progress, chosen.length - 1)]?.title}」</strong>
        <span className="qx-meta">{progress} / {chosen.length} · 同时从对话里整理 Uni 需要记住的事</span>
      </div> : null}

      {step === 'done' ? <div className="xb-import__state">
        <CheckCircleIcon className="xb-import__done" aria-hidden="true" />
        <strong>导入了 {chosen.length} 个对话</strong>
        <span className="qx-meta">Uni 从里面记下了 3 件事，可以在设定里查看和修改</span>
        <button type="button" className="qx-btn qx-btn--primary" onClick={() => onImported(chosen.map(item => item.id))}>去看看</button>
      </div> : null}
    </div>
  </SettingsModal>
}
