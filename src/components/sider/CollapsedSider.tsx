import { IconPanelLeftOutline16, NewChatIcon } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { AgentOrb } from '../platform/AgentOrb.js'
import type { WorkspaceView } from '../platform/workspaceView.js'
import styles from './Sider.module.css'

export const CollapsedSider = ({ onView }: { onView: (view: WorkspaceView) => void }) => {
  const t = useTranslate()
  return (
    <div className={styles.collapsed}>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={() => {
            newChat()
            onView('chat')
          }}
        />
        <button
          className={styles.collapsedAgent}
          aria-label="Personal Agent"
          onClick={() => onView('agent')}
        >
          <AgentOrb size="small" />
        </button>
      </div>
    </div>
  )
}
