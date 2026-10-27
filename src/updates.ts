import { useSyncExternalStore } from 'react'

// Nieuwe versie van de app. Normaal neemt de nieuwe service worker direct over en herlaadt hij de vensters
// (public/sw-vensters.js); de outbox staat in IndexedDB en overleeft herladen. Wacht er toch een service worker, dan
// toont de balk "Herladen".

type Listener = () => void

class Updates {
  private available = false
  private apply: (() => void) | null = null
  private readonly listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isAvailable(): boolean {
    return this.available
  }

  /** Door de service-worker-registratie aangeroepen zodra een nieuwe versie klaarstaat. */
  announce(apply: () => void): void {
    this.available = true
    this.apply = apply
    for (const l of this.listeners) l()
  }

  /** Activeert de nieuwe service worker; die herlaadt daarna de pagina. */
  reload(): void {
    this.apply?.()
  }
}

export const updates = new Updates()

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => updates.subscribe(l),
    () => updates.isAvailable(),
  )
}
