export type ConversationToolStep = {
  id: string
  label: string
  status: 'running' | 'completed' | 'failed'
  interrupted?: boolean
  purpose?: string
  input?: unknown
  output?: unknown
  detail?: string
  resultItems?: readonly { id: string; title: string; excerpt?: string | null }[]
}
export type ConversationTurnView = {
  id: string
  question: string
  answer: string
  toolSteps?: readonly ConversationToolStep[]
  streaming?: boolean
  statusText?: string
}
