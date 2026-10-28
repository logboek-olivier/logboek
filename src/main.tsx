import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './app.css'
import { listenForNewVersion, updates } from './updates'

const root = document.getElementById('root')
if (!root) throw new Error('root ontbreekt')

// Een nieuwe service worker neemt zelf over en herlaadt de vensters (public/sw-vensters.js). Blijft er toch een
// wachten (bijvoorbeeld een oudere service worker), dan meldt de balk dat er een nieuwe versie klaarstaat.
listenForNewVersion()
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updates.announce(() => void updateSW(true))
  },
  // Ook een app die lang openstaat vindt een nieuwe versie: bij terugkomen en elk uur opnieuw kijken.
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => void registration.update().catch(() => undefined)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    window.addEventListener('online', check)
    setInterval(check, 60 * 60 * 1000)
  },
})

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
