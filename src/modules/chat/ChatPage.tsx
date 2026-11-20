import {
  ChatCircleIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  EnvelopeSimpleIcon,
  GlobeIcon,
  PaperclipIcon,
  PresentationChartIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { Conversation, Model } from '../../../contract/types'
import { Composer } from '../../shared/ui/Composer'
import { ConversationLayout } from '../../vendor/everplain/app/conversation-view/ConversationLayout'
import '../../vendor/everplain/app/conversation-view/conversation-view.css'
import { displayDate } from '../../shared/displayDate'
import { OctoMark } from '../../shared/ui/Brand'
import { ModelPicker } from '../../shared/ui/ModelPicker'
import { useComposer } from '../../shared/ui/useComposer'
import { ChatActions } from './ChatActions'
import { TurnView } from './TurnView'
import type { SendOptions } from './useConversations'

type ChatPageProps = {
  conversation: Conversation
  balance?: number
  models: Model[]
  agentName: string
  searchEnabled: boolean
  onSend: (text: string, options: SendOptions) => void
  onRename: (title: string) => void
  onPin: () => void
  onDelete: () => void
  onStop: () => void
  onModelChange: (id: string) => void
  onOpenAgent: (taskId?: string) => void
  onOpenImport: () => void
}

export function ChatPage({
  conversation,
  balance,
  models,
  agentName,
  searchEnabled,
  onSend,
  onModelChange,
  onOpenAgent,
  onOpenImport,
  onRename,
  onPin,
  onDelete,
  onStop,
}: ChatPageProps) {
  const [search, setSearch] = useState(false)
  const [handoff, setHandoff] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const empty = conversation.turns.length === 0
  const streaming = conversation.turns.some((turn) => turn.streaming)
  const composer = useComposer(!streaming && models.length > 0, (text, files) => {
    onSend(text, { search, handoff, files })
    setHandoff(false)
  })
  const { setValue, closeTools, openFilePicker, focus } = composer
  const lastAnswerLength = conversation.turns.at(-1)?.answer.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [conversation.turns.length, lastAnswerLength])
  useEffect(() => {
    setValue('')
    setHandoff(false)
  }, [conversation.id, setValue])

  const tools = (
    <div className="cv-tool-attachments">
      <button className="qx-btn" type="button" role="menuitem" onClick={openFilePicker}>
        <PaperclipIcon aria-hidden="true" />
        上传文件
      </button>
      <button
        className="qx-btn"
        type="button"
        role="menuitemcheckbox"
        aria-checked={search}
        disabled={!searchEnabled}
        onClick={() => {
          setSearch((value) => !value)
          closeTools()
        }}
      >
        <GlobeIcon aria-hidden="true" />
        联网搜索{search ? <CheckIcon className="xb-menu-check" aria-hidden="true" /> : null}
      </button>
      <button
        className="qx-btn"
        type="button"
        role="menuitem"
        onClick={() => {
          setValue((current) => current || '把上面的内容做成一份演示文稿')
          setHandoff(true)
          closeTools()
          focus()
        }}
      >
        <PresentationChartIcon aria-hidden="true" />
        生成演示文稿
      </button>
      <button
        className="qx-btn"
        type="button"
        role="menuitemcheckbox"
        aria-checked={handoff}
        onClick={() => {
          setHandoff((value) => !value)
          closeTools()
          focus()
        }}
      >
        <OctoMark size={18} />
        交给{agentName}去做
        {handoff ? <CheckIcon className="xb-menu-check" aria-hidden="true" /> : null}
      </button>
    </div>
  )

  const composerView = (
    <>
      <Composer
        composer={composer}
        scopeKey={conversation.id}
        label="给 Unigate Chat 发消息"
        placeholder={empty ? '问点什么，或者接着聊' : '继续聊'}
        canStop={streaming}
        tools={tools}
        context={
          handoff ? (
            <div className="xb-composer-chip">
              <OctoMark size={18} />
              <span>这一条交给{agentName}，它做好会在自己那里告诉你</span>
              <button
                type="button"
                className="qx-btn qx-btn--ghost qx-btn--icon"
                aria-label="取消交给 Uni "
                onClick={() => setHandoff(false)}
              >
                <XIcon />
              </button>
            </div>
          ) : undefined
        }
        modelSelector={
          <div className="xb-composer-meta">
            {search ? (
              <button
                type="button"
                className="qx-tag xb-search-tag"
                aria-pressed="true"
                aria-label="关闭联网搜索"
                onClick={() => setSearch(false)}
              >
                <GlobeIcon aria-hidden="true" />
                联网
              </button>
            ) : null}
            <ModelPicker
              value={conversation.model}
              onChange={onModelChange}
              balance={balance}
              models={models}
            />
          </div>
        }
        onStop={onStop}
      />
      {empty ? (
        <div className="xb-suggestions">
          <button type="button" className="qx-item" onClick={onOpenImport}>
            <ClockCounterClockwiseIcon weight="bold" aria-hidden="true" />
            导入 DeepSeek 记录，接着原来的对话聊
          </button>
          <button
            type="button"
            className="qx-item"
            onClick={() => {
              setValue('帮我写一封请假邮件，明天上午去医院')
              focus()
            }}
          >
            <EnvelopeSimpleIcon weight="bold" aria-hidden="true" />
            写一封请假邮件
          </button>
          <button
            type="button"
            className="qx-item"
            onClick={() => {
              setValue('今天有点累，陪我聊一会儿')
              focus()
            }}
          >
            <ChatCircleIcon weight="bold" aria-hidden="true" />
            陪我聊一会儿
          </button>
        </div>
      ) : null}
    </>
  )

  const thread = (
    <div className="cv-thread">
      {conversation.imported ? (
        <p className="cv-turn__provenance xb-provenance">
          <ClockCounterClockwiseIcon />
          {conversation.imported.source === 'legacy' ? '从旧版导入' : '从 DeepSeek 导入'} ·{' '}
          {conversation.imported.messages} 条消息 · 最后一次{' '}
          {displayDate(conversation.imported.last)}
          <span>上下文已经接上，往下聊就行</span>
        </p>
      ) : null}
      {conversation.turns.map((turn, index) => (
        <TurnView
          key={turn.id}
          turn={turn}
          conversationId={conversation.id}
          onOpenAgent={onOpenAgent}
          agentName={agentName}
          onRegenerate={
            !turn.imported && !turn.task && !streaming && index === conversation.turns.length - 1
              ? () => onSend(turn.question, { search, handoff: false, replaceId: turn.id })
              : undefined
          }
        />
      ))}
      <div ref={endRef} />
    </div>
  )

  return (
    <ConversationLayout
      embedded={false}
      empty={empty}
      research={false}
      runtimeMode="standard"
      sourceOpen={false}
      title={conversation.title}
      label={conversation.title}
      modes={<div className="cv-mode-switch" />}
      actions={
        empty ? null : (
          <ChatActions
            conversation={conversation}
            onRename={onRename}
            onPin={onPin}
            onDelete={onDelete}
          />
        )
      }
      pet={null}
      prompt="今天想聊点什么？"
      thread={thread}
      composer={composerView}
    />
  )
}
