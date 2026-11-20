import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './vendor/everplain/styles/tokens.css'
import './vendor/everplain/styles/base.css'
import './vendor/everplain/styles/components.css'
import './vendor/everplain/styles/system-theme.css'
import { App } from './app/App'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Application root is missing')
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
