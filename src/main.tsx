import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './app.css'
import { updates } from './updates'

const root = document.getElementById('root')
if (!root) throw new Error('root ontbreekt')

// Nieuwe versie: melden, nooit zelf herladen (zie src/updates.ts).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updates.announce(() => void updateSW(true))
  },
})

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
