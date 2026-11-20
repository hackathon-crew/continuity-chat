import { useEffect, useState } from 'react'

export type Scheme = 'system' | 'light' | 'dark'

export function useTheme() {
  const [scheme, setScheme] = useState<Scheme>(() => {
    const stored = localStorage.getItem('unigate-scheme')
    return stored === 'dark' || stored === 'light' ? stored : 'system'
  })
  useEffect(() => {
    const root = document.documentElement
    if (scheme === 'system') {
      root.removeAttribute('data-color-scheme')
    } else {
      root.setAttribute('data-color-scheme', scheme)
    }
    localStorage.setItem('unigate-scheme', scheme)
  }, [scheme])

  return { scheme, setScheme }
}
