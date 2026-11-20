import type { ChatTask, Conversation } from '../../contract/types'
import { ChatPage } from '../modules/chat/ChatPage'
import type { useConversations } from '../modules/chat/useConversations'
import { errorText, useSession } from './SessionContext'

type ChatWorkspaceProps = {
  conversation: Conversation
  workspace: ReturnType<typeof useConversations>
  states: ReadonlyMap<string, ChatTask['status']>
  agentName: string
  searchEnabled: boolean
  defaultModel: string
  onDeleted: () => void
  onOpenAgent: (taskId?: string) => void
  onOpenImport: () => void
}

export function ChatWorkspace({
  conversation,
  workspace,
  states,
  agentName,
  searchEnabled,
  defaultModel,
  onDeleted,
  onOpenAgent,
  onOpenImport,
}: ChatWorkspaceProps) {
  const { billing, models, setError } = useSession()
  const displayConversation = {
    ...conversation,
    turns: conversation.turns.map((turn) =>
      turn.task && states.has(turn.task.id)
        ? { ...turn, task: { ...turn.task, status: states.get(turn.task.id) ?? turn.task.status } }
        : turn
    ),
  }

  function edit(patch: Partial<Pick<Conversation, 'model' | 'title' | 'pinned'>>) {
    void workspace.edit(conversation, patch).catch((failure) => setError(errorText(failure)))
  }

  return (
    <ChatPage
      conversation={displayConversation}
      agentName={agentName}
      searchEnabled={searchEnabled}
      balance={billing?.balance}
      models={models}
      onSend={(text, options) => {
        void workspace.send(conversation, text, conversation.model || defaultModel, options)
      }}
      onModelChange={(model) => edit({ model })}
      onRename={(title) => edit({ title })}
      onPin={() => edit({ pinned: !conversation.pinned })}
      onDelete={() => {
        void workspace
          .remove(conversation.id)
          .then(onDeleted, (failure) => setError(errorText(failure)))
      }}
      onStop={() => workspace.stop(conversation.id)}
      onOpenAgent={onOpenAgent}
      onOpenImport={onOpenImport}
    />
  )
}
