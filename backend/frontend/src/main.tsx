import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './LandingPage'

function AppRouter() {
  const [mode, setMode] = useState<'landing' | 'organizer'>('landing')

  if (mode === 'organizer') {
    return <App />
  }

  return <LandingPage onOpenAdmin={() => setMode('organizer')} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
