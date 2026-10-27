import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './app.css'
import { updates } from './updates'

const root = document.getElementById('root')
if (!root) throw new Error('root ontbreekt')

// Een nieuwe service worker neemt zelf over en herlaadt de vensters (public/sw-vensters.js). Blijft er toch een
// wachten (bijvoorbeeld een oudere service worker), dan meldt de balk dat er een nieuwe versie klaarstaat.
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
