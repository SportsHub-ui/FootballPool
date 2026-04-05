import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './LandingPage'

if (typeof document !== 'undefined') {
  document.title = import.meta.env.DEV ? 'Football Pool (DEV)' : 'Football Pool'
}

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
