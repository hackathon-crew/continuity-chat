import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './everplain/styles/tokens.css'
import './everplain/styles/base.css'
import './everplain/styles/components.css'
import './everplain/styles/system-theme.css'
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
