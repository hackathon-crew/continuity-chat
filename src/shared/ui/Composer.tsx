import {
  ConversationComposer,
  type ConversationComposerProps,
} from '../../vendor/everplain/app/conversation-view/ConversationComposer'
import type { useComposer } from './useComposer'

const MESSAGE_LIMIT = 8000
const ACCEPTED_FILES = '.txt,.md,.png,.jpg,.jpeg,.webp,.gif'

type ComposerProps = Pick<
  ConversationComposerProps,
  | 'scopeKey'
  | 'label'
  | 'placeholder'
  | 'canStop'
  | 'tools'
  | 'context'
  | 'modelSelector'
  | 'onStop'
> & {
  composer: ReturnType<typeof useComposer>
}

export function Composer({ composer, ...props }: ComposerProps) {
  return (
    <ConversationComposer
      {...props}
      {...composer.props}
      mode="standard"
      maxLength={MESSAGE_LIMIT}
      busy={false}
      uploading={false}
      accept={ACCEPTED_FILES}
    />
  )
}
