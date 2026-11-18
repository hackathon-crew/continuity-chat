import clsx from 'clsx'
import type { PlatformUser } from '../../services/platform.js'
import styles from './Platform.module.css'

export type WorkspaceView = 'chat' | 'studio' | 'agent' | 'tasks' | 'account'

const items: { id: WorkspaceView; label: string }[] = [
  { id: 'chat', label: '对话' },
  { id: 'studio', label: 'Soul · Memory · Tools' },
  { id: 'agent', label: 'Personal Agent' },
  { id: 'tasks', label: '自动化' },
  { id: 'account', label: '账户与计费' },
]

export const WorkspaceNav = ({
  view,
  onView,
  user,
}: {
  view: WorkspaceView
  onView: (view: WorkspaceView) => void
  user: PlatformUser
}) => (
  <nav className={styles.workspaceNav} aria-label="工作区">
    <div className={styles.navBrand}>续伴</div>
    <div className={styles.navItems}>
      {items.map((item) => (
        <button
          key={item.id}
          className={clsx(styles.navItem, view === item.id && styles.navItemActive)}
          onClick={() => onView(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
    <div className={styles.navSpacer} />
    <div className={styles.navUser}>
      <span>{user.name}</span>
      <span className={styles.avatar}>{user.name.slice(0, 1).toUpperCase()}</span>
    </div>
  </nav>
)
