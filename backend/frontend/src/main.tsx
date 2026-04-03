import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ParticipantView } from './ParticipantView'

function AppRouter() {
  const [mode, setMode] = useState<'menu' | 'organizer' | 'participant'>('menu')

  if (mode === 'organizer') {
    return <App />
  }

  if (mode === 'participant') {
    return <ParticipantView />
  }

  // Menu
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #ffe4b8, #ffd4c5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        background: 'white',
        padding: '2rem',
        borderRadius: '20px',
        boxShadow: '0 16px 32px rgba(131, 74, 27, 0.2)',
        textAlign: 'center',
        maxWidth: '400px'
      }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '2rem' }}>Football Pool</h1>
        <p style={{ color: '#666', marginBottom: '2rem' }}>Choose your role</p>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <button
            onClick={() => setMode('organizer')}
            style={{
              padding: '1rem',
              background: '#c85b2a',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Organizer Dashboard
          </button>
          <button
            onClick={() => setMode('participant')}
            style={{
              padding: '1rem',
              background: '#233042',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Participant View
          </button>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
