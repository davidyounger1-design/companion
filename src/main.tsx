import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { applyCachedBranding, refreshBranding } from './lib/branding'

// Apply last-known platform branding before first paint; refresh in background.
applyCachedBranding()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

refreshBranding()
