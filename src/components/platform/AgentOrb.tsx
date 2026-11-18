import clsx from 'clsx'
import styles from './AgentOrb.module.css'

export const AgentOrb = ({
  size = 'medium',
  active = false,
  running = false,
}: {
  size?: 'small' | 'medium' | 'large'
  active?: boolean
  running?: boolean
}) => (
  <span
    className={clsx(styles.orb, styles[size], active && styles.active, running && styles.running)}
    aria-hidden="true"
  >
    <span className={styles.core} />
    <span className={styles.status} />
  </span>
)
