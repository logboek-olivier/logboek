import { lazy, type ComponentType } from 'react'

// Schermen, kaarten en grafieken laden pas als ze geopend worden, zodat de app snel opent. Alles staat in de precache,
// dus dit werkt ook offline. Mislukt het laden omdat een nieuwe versie net de oude bestanden opruimde, dan één keer
// herladen (dat haalt de nieuwe versie); daarna gewoon de fout.

const RELOAD_KEY = 'logboek-herladen-na-update'
const RELOAD_GAP_MS = 60_000

export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => {
    try {
      return { default: await load() }
    } catch (error) {
      let last: number
      try {
        last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
      } catch {
        // Geen opslag: dan niet herladen (geen lus).
        throw error
      }
      if (Date.now() - last > RELOAD_GAP_MS) {
        try {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        } catch {
          throw error
        }
        location.reload()
        return new Promise<never>(() => undefined)
      }
      throw error
    }
  })
}
