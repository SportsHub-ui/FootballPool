import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LandingPage } from './LandingPage'

if (typeof document !== 'undefined') {
  document.title = import.meta.env.DEV ? 'Football Pool (DEV)' : 'Football Pool'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
)
